import { existsSync } from "node:fs";
import type {
	CreateRunRequest,
	Run,
	RunExecutionMode,
	RunRecording,
	RunScreenMode,
	RunStatus,
	RunStep,
	RunTest,
	RunTestStatus,
	StepPhases,
} from "@yoqa/runner-client";
import { stepPhasesSchema } from "@yoqa/runner-client";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { installBuildOnDevice, resolveBuildForRun } from "../builds/application";
import { getApp, getCase, getCaseScriptJson, saveCaseScript } from "../catalog/application";
import { getCatalogDb } from "../catalog/db";
import { cases } from "../catalog/schema";
import { acquireSessionForRun, releaseSessionFromRun } from "../devices/active-session";
import { pruneOldRunScreenshots } from "../devices/screenshot-retention";
import type { DeviceSession } from "../devices/session";
import { type ActiveProviderAuth, resolveActiveProviderAuth } from "../providers/application";
import {
	type AgentDecision,
	AgentProviderError,
	assertVisionCapableProvider,
	decideNextAction,
} from "./agent";
import {
	executeAgentCase as runAgentCase,
	executeScriptCase as runScriptCase,
} from "./case-executor";
import {
	CUT_OFF_NOTE,
	RUN_VIDEO_DIR,
	deleteRunVideo,
	readyVideoPath,
	recordCase,
	recordingFromRow,
	runVideoPath,
} from "./run-recording";
import { runSteps, runTests, runs } from "./schema";
import { buildScriptFromDecisions, parseCaseScript, serializeCaseScript } from "./script";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["passed", "errored", "cancelled"]);

type RunControl = {
	aborted: boolean;
};

const runControls = new Map<string, RunControl>();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RunValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunValidationError";
	}
}

export class RunNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunNotFoundError";
	}
}

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

function parseAction(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return {};
	}
}

function parsePhases(raw: string | null): StepPhases | null {
	if (!raw) return null;
	try {
		return stepPhasesSchema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

function isAborted(runId: string): boolean {
	return runControls.get(runId)?.aborted === true;
}

function registerControl(runId: string): RunControl {
	const existing = runControls.get(runId);
	if (existing) return existing;
	const control: RunControl = { aborted: false };
	runControls.set(runId, control);
	return control;
}

function clearControl(runId: string): void {
	runControls.delete(runId);
}

function parseRunExecutionMode(value: string | null | undefined): RunExecutionMode {
	if (value === "script" || value === "agent" || value === "auto") return value;
	return "auto";
}

/** Rows from before Screen modes existed ran with the tree. */
function parseRunScreenMode(value: string | null | undefined): RunScreenMode {
	return value === "vision" ? "vision" : "tree";
}

function resolveCaseExecutionMode(
	runMode: RunExecutionMode,
	hasScript: boolean,
): "script" | "agent" {
	if (runMode === "agent") return "agent";
	if (hasScript) return "script";
	return "agent";
}

/** A finished Run whose executeRun has fully wound down (its control is cleared last). */
function isSettled(runId: string, status: string): boolean {
	return TERMINAL_RUN_STATUSES.has(status as RunStatus) && !runControls.has(runId);
}

async function loadRun(runId: string): Promise<Run | null> {
	const db = getCatalogDb();
	const runRow = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
	if (!runRow) return null;

	const testRows = await db.select().from(runTests).where(eq(runTests.runId, runId));
	const tests: RunTest[] = [];
	for (const test of testRows) {
		const stepRows = await db
			.select()
			.from(runSteps)
			.where(eq(runSteps.runTestId, test.id))
			.orderBy(asc(runSteps.idx));
		const steps: RunStep[] = stepRows.map((step) => ({
			id: step.id,
			runTestId: step.runTestId,
			idx: step.idx,
			action: parseAction(step.actionJson),
			screenshotUri: step.screenshotUri,
			ok: step.ok === 1,
			latencyMs: step.latencyMs,
			phases: parsePhases(step.phasesJson),
			detail: step.detail,
			command: step.command ?? null,
			createdAt: step.createdAt,
		}));
		const caseMode =
			test.executionMode === "script" || test.executionMode === "agent" ? test.executionMode : null;
		tests.push({
			id: test.id,
			runId: test.runId,
			caseId: test.caseId,
			status: test.status as RunTestStatus,
			executionMode: caseMode,
			error: test.error,
			startedAt: test.startedAt,
			finishedAt: test.finishedAt,
			currentCommand: test.currentCommand ?? null,
			recording: recordingFromRow(test, isSettled(runId, runRow.status)),
			steps,
		});
	}

	return {
		id: runRow.id,
		appId: runRow.appId,
		deviceId: runRow.deviceId,
		platform: runRow.platform as Run["platform"],
		buildId: runRow.buildId,
		status: runRow.status as RunStatus,
		executionMode: parseRunExecutionMode(runRow.executionMode),
		screenMode: parseRunScreenMode(runRow.screenMode),
		lane: runRow.lane === "direct" || runRow.lane === "appium" ? runRow.lane : undefined,
		laneWarning: runRow.laneWarning ?? undefined,
		error: runRow.error,
		createdAt: runRow.createdAt,
		startedAt: runRow.startedAt,
		finishedAt: runRow.finishedAt,
		tests,
	};
}

async function appendStep(input: {
	runTestId: string;
	idx: number;
	action: unknown;
	screenshotUri: string | null;
	ok: boolean;
	latencyMs: number;
	phases?: StepPhases | null;
	detail: string | null;
	command: string | null;
}): Promise<void> {
	const db = getCatalogDb();
	await db.insert(runSteps).values({
		id: newId("rstep"),
		runTestId: input.runTestId,
		idx: input.idx,
		actionJson: JSON.stringify(input.action ?? {}),
		screenshotUri: input.screenshotUri,
		ok: input.ok ? 1 : 0,
		latencyMs: Math.max(0, Math.round(input.latencyMs)),
		phasesJson: input.phases ? JSON.stringify(input.phases) : null,
		detail: input.detail,
		command: input.command,
		createdAt: Date.now(),
	});
}

async function setCurrentCommand(runTestId: string, command: string | null): Promise<void> {
	const db = getCatalogDb();
	await db.update(runTests).set({ currentCommand: command }).where(eq(runTests.id, runTestId));
}

async function updateCaseLastRun(
	caseId: string,
	status: "passed" | "errored",
	at: number,
): Promise<void> {
	const db = getCatalogDb();
	await db
		.update(cases)
		.set({
			lastRunAt: at,
			lastRunStatus: status,
			updatedAt: at,
		})
		.where(eq(cases.id, caseId));
}

async function persistCancelled(runId: string): Promise<void> {
	const db = getCatalogDb();
	const finishedAt = Date.now();
	await db
		.update(runs)
		.set({
			status: "cancelled",
			finishedAt,
			error: null,
		})
		.where(eq(runs.id, runId));

	const testRows = await db.select().from(runTests).where(eq(runTests.runId, runId));
	for (const test of testRows) {
		if (test.status === "queued" || test.status === "running") {
			await db
				.update(runTests)
				.set({
					status: "cancelled",
					error: "Cancelled by user",
					finishedAt,
					currentCommand: null,
				})
				.where(eq(runTests.id, test.id));
		}
	}
}

async function executeScriptCase(input: {
	runId: string;
	runTestId: string;
	caseId: string;
	session: DeviceSession;
}): Promise<"passed" | "errored" | "cancelled"> {
	const script = parseCaseScript(await getCaseScriptJson(input.caseId));
	if (!script) {
		return "errored";
	}

	return runScriptCase({
		script,
		session: input.session,
		isAborted: () => isAborted(input.runId),
		appendStep: async (step) => {
			await appendStep({
				runTestId: input.runTestId,
				...step,
			});
		},
		setCurrentCommand: async (command) => {
			await setCurrentCommand(input.runTestId, command);
		},
		clock: { sleep, now: () => Date.now() },
	});
}

async function executeAgentCase(input: {
	runId: string;
	runTestId: string;
	caseId: string;
	appContext: string;
	appKnowledge?: string;
	session: DeviceSession;
	auth: ActiveProviderAuth;
	screenMode: RunScreenMode;
	defaultAppId?: string;
}): Promise<{
	status: "passed" | "errored" | "cancelled";
	decisions: AgentDecision[];
	error: string | null;
}> {
	const catalogCase = await getCase(input.caseId);
	if (!catalogCase) {
		throw new RunValidationError(`Case not found: ${input.caseId}`);
	}

	return runAgentCase({
		catalogCase,
		appContext: input.appContext,
		appKnowledge: input.appKnowledge,
		auth: input.auth,
		session: input.session,
		isAborted: () => isAborted(input.runId),
		appendStep: async (step) => {
			await appendStep({
				runTestId: input.runTestId,
				...step,
			});
		},
		setCurrentCommand: async (command) => {
			await setCurrentCommand(input.runTestId, command);
		},
		decide: decideNextAction,
		screenMode: input.screenMode,
		clock: { sleep, now: () => Date.now() },
		defaultAppId: input.defaultAppId,
	});
}

async function executeCase(input: {
	runId: string;
	runTestId: string;
	caseId: string;
	appContext: string;
	appKnowledge?: string;
	session: DeviceSession;
	auth: ActiveProviderAuth | null;
	caseMode: "script" | "agent";
	screenMode: RunScreenMode;
	defaultAppId?: string;
}): Promise<"passed" | "errored" | "cancelled"> {
	const db = getCatalogDb();

	if (isAborted(input.runId)) {
		return "cancelled";
	}

	const startedAt = Date.now();
	await db
		.update(runTests)
		.set({
			status: "running",
			startedAt,
			error: null,
			executionMode: input.caseMode,
			currentCommand: null,
		})
		.where(eq(runTests.id, input.runTestId));

	let caseStatus: "passed" | "errored" | "cancelled";
	let caseError: string | null = null;
	let decisions: AgentDecision[] = [];

	if (input.caseMode === "script") {
		const scriptStatus = await executeScriptCase({
			runId: input.runId,
			runTestId: input.runTestId,
			caseId: input.caseId,
			session: input.session,
		});
		if (scriptStatus === "errored") {
			const script = parseCaseScript(await getCaseScriptJson(input.caseId));
			caseError = script ? "Saved script replay failed" : "Saved script is missing or invalid";
		}
		caseStatus = scriptStatus;
	} else if (!input.auth) {
		caseStatus = "errored";
		caseError = "No vision-capable provider configured for AI agent runs";
	} else {
		const result = await executeAgentCase({
			runId: input.runId,
			runTestId: input.runTestId,
			caseId: input.caseId,
			appContext: input.appContext,
			appKnowledge: input.appKnowledge,
			session: input.session,
			auth: input.auth,
			screenMode: input.screenMode,
			defaultAppId: input.defaultAppId,
		});
		caseStatus = result.status;
		decisions = result.decisions;
		caseError = result.error;
	}

	if (isAborted(input.runId) || caseStatus === "cancelled") {
		return "cancelled";
	}

	const finishedAt = Date.now();
	await db
		.update(runTests)
		.set({
			status: caseStatus,
			error: caseError,
			finishedAt,
			currentCommand: null,
		})
		.where(eq(runTests.id, input.runTestId));
	await updateCaseLastRun(input.caseId, caseStatus, finishedAt);

	// Persist a replayable script after a successful AI agent run.
	if (caseStatus === "passed" && input.caseMode === "agent") {
		const script = buildScriptFromDecisions(decisions, input.runId);
		if (script) {
			await saveCaseScript(input.caseId, serializeCaseScript(script), script.savedAt);
		}
	}

	return caseStatus;
}

async function saveCaseRecording(runTestId: string, state: RunRecording): Promise<void> {
	await getCatalogDb()
		.update(runTests)
		.set({ recordingStatus: state.status, recordingNote: state.note ?? null })
		.where(eq(runTests.id, runTestId));
}

export async function executeRun(runId: string): Promise<void> {
	const db = getCatalogDb();
	const run = await loadRun(runId);
	if (!run) return;

	registerControl(runId);

	let session: DeviceSession | null = null;
	let sharedSession = true;
	try {
		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		const startedAt = Date.now();
		await db
			.update(runs)
			.set({ status: "running", startedAt, error: null })
			.where(eq(runs.id, runId));

		// Reclaim old run evidence in the background; never blocks or fails a run.
		void pruneOldRunScreenshots();

		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		const app = await getApp(run.appId);
		if (!app) {
			throw new RunValidationError("App not found");
		}

		const caseModes: Array<{ caseId: string; mode: "script" | "agent" }> = [];
		for (const test of run.tests) {
			const catalogCase = await getCase(test.caseId);
			const hasScript = Boolean(catalogCase?.hasScript);
			caseModes.push({
				caseId: test.caseId,
				mode: resolveCaseExecutionMode(run.executionMode, hasScript),
			});
		}
		const needsAgent = caseModes.some((item) => item.mode === "agent");

		let auth: ActiveProviderAuth | null = null;
		if (needsAgent) {
			auth = await assertVisionCapableProvider(await resolveActiveProviderAuth());
		}

		if (run.buildId) {
			const build = await resolveBuildForRun({ buildId: run.buildId, appId: run.appId });
			if (build) {
				await installBuildOnDevice({
					build,
					deviceId: run.deviceId,
					platform: run.platform,
				});
			}
		}

		const firstCase = run.tests[0] ? await getCase(run.tests[0].caseId) : null;
		const runRow = (await db.select().from(runs).where(eq(runs.id, runId)))[0];
		const requestedLane = runRow?.requestedLane;
		// Adopt the shared Active Session when it already targets this device;
		// otherwise connect (replacing any unheld session) and keep it live after.
		const acquired = await acquireSessionForRun({
			runId,
			deviceId: run.deviceId,
			platform: run.platform,
			appCaps: app.capabilities,
			caseCaps: firstCase?.capabilities ?? [],
			bundleId: app.iosBundleId || undefined,
			appPackage: app.androidApplicationId || undefined,
			requestedLane:
				requestedLane === "direct" || requestedLane === "appium" || requestedLane === "auto"
					? requestedLane
					: undefined,
		});
		const activeSession = acquired.session;
		session = activeSession;
		sharedSession = acquired.shared;
		await db
			.update(runs)
			.set({
				lane: session.lane,
				laneWarning: session.laneWarning ?? null,
			})
			.where(eq(runs.id, runId));

		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		let anyFailed = false;
		for (const test of run.tests) {
			if (isAborted(runId)) {
				await persistCancelled(runId);
				return;
			}

			const catalogCase = await getCase(test.caseId);
			if (!catalogCase) {
				anyFailed = true;
				await db
					.update(runTests)
					.set({
						status: "errored",
						error: "Case not found",
						finishedAt: Date.now(),
					})
					.where(eq(runTests.id, test.id));
				continue;
			}

			const caseMode =
				caseModes.find((item) => item.caseId === test.caseId)?.mode ??
				resolveCaseExecutionMode(run.executionMode, catalogCase.hasScript);

			const status = await recordCase(
				activeSession,
				runVideoPath(test.id),
				{
					// The Run can ask for every case; otherwise each case decides for itself.
					enabled: runRow?.recordVideo === 1 || catalogCase.recordVideo,
					onState: (state) => saveCaseRecording(test.id, state),
				},
				() =>
					executeCase({
						runId,
						runTestId: test.id,
						caseId: test.caseId,
						appContext: app.context,
						appKnowledge: app.knowledge,
						session: activeSession,
						auth,
						caseMode,
						screenMode: run.screenMode ?? "tree",
						defaultAppId:
							run.platform === "ios"
								? app.iosBundleId || undefined
								: app.androidApplicationId || undefined,
					}),
			);
			// The Run was deleted while this case was recording; do not leave its video behind.
			if (!(await loadRun(runId))) await deleteRunVideo(test.id);
			if (status === "cancelled" || isAborted(runId)) {
				await persistCancelled(runId);
				return;
			}
			if (status === "errored") anyFailed = true;
		}

		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		const finishedAt = Date.now();
		await db
			.update(runs)
			.set({
				status: anyFailed ? "errored" : "passed",
				finishedAt,
				error: null,
			})
			.where(eq(runs.id, runId));
	} catch (error) {
		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		const finishedAt = Date.now();
		await db
			.update(runs)
			.set({
				status: "errored",
				error: message,
				finishedAt,
			})
			.where(eq(runs.id, runId));

		const current = await loadRun(runId);
		if (current) {
			for (const test of current.tests) {
				if (test.status === "queued" || test.status === "running") {
					await db
						.update(runTests)
						.set({
							status: "errored",
							error: message,
							finishedAt,
						})
						.where(eq(runTests.id, test.id));
					await updateCaseLastRun(test.caseId, "errored", finishedAt);
				}
			}
		}
	} finally {
		if (session) {
			// Shared sessions stay live as the Active Session; detached ones are quit.
			await releaseSessionFromRun(runId, session, sharedSession);
		}
		clearControl(runId);
	}
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
	if (runControls.size > 0) {
		throw new RunValidationError(
			"A run is already in progress. Cancel it before starting another.",
		);
	}

	const uniqueCaseIds = [...new Set(input.caseIds)];
	if (uniqueCaseIds.length === 0) {
		throw new RunValidationError("At least one case id is required");
	}

	const app = await getApp(input.appId);
	if (!app) {
		throw new RunValidationError("App not found");
	}

	const executionMode: RunExecutionMode = input.executionMode ?? "auto";
	const screenMode: RunScreenMode = input.screenMode ?? "vision";
	const catalogCases = [];
	for (const caseId of uniqueCaseIds) {
		const catalogCase = await getCase(caseId);
		if (!catalogCase) {
			throw new RunValidationError(`Case not found: ${caseId}`);
		}
		if (catalogCase.appId !== input.appId) {
			throw new RunValidationError(`Case ${caseId} does not belong to app ${input.appId}`);
		}
		catalogCases.push(catalogCase);
	}

	const needsAgent = catalogCases.some(
		(catalogCase) => resolveCaseExecutionMode(executionMode, catalogCase.hasScript) === "agent",
	);

	if (needsAgent) {
		try {
			await assertVisionCapableProvider(await resolveActiveProviderAuth());
		} catch (error) {
			if (error instanceof AgentProviderError) {
				throw new RunValidationError(error.message);
			}
			throw error;
		}
	}

	const db = getCatalogDb();
	const now = Date.now();
	const runId = newId("run");

	let buildId = input.buildId ?? null;
	if (input.buildPath) {
		const build = await resolveBuildForRun({
			buildPath: input.buildPath,
			appId: input.appId,
		});
		buildId = build?.id ?? null;
	}

	await db.insert(runs).values({
		id: runId,
		appId: input.appId,
		deviceId: input.deviceId,
		platform: input.platform,
		buildId,
		status: "queued",
		executionMode,
		screenMode,
		requestedLane: input.lane ?? null,
		recordVideo: input.recordVideo ? 1 : 0,
		error: null,
		createdAt: now,
		startedAt: null,
		finishedAt: null,
	});

	for (const caseId of uniqueCaseIds) {
		await db.insert(runTests).values({
			id: newId("rtest"),
			runId,
			caseId,
			status: "queued",
			executionMode: null,
			error: null,
			startedAt: null,
			finishedAt: null,
		});
	}

	const created = await loadRun(runId);
	if (!created) {
		throw new Error("Failed to create run");
	}

	void executeRun(runId).catch((error) => {
		console.error(`[runs] executeRun ${runId} failed`, error);
	});

	return created;
}

export async function getRun(runId: string): Promise<Run> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}
	return run;
}

export async function listRuns(appId: string): Promise<Run[]> {
	const app = await getApp(appId);
	if (!app) {
		throw new RunValidationError("App not found");
	}

	const db = getCatalogDb();
	const runRows = await db
		.select()
		.from(runs)
		.where(eq(runs.appId, appId))
		.orderBy(desc(runs.createdAt));

	if (runRows.length === 0) {
		return [];
	}

	const runIds = runRows.map((row) => row.id);
	const testRows = await db.select().from(runTests).where(inArray(runTests.runId, runIds));

	const settledByRunId = new Map(runRows.map((row) => [row.id, isSettled(row.id, row.status)]));
	const testsByRunId = new Map<string, RunTest[]>();
	for (const test of testRows) {
		const list = testsByRunId.get(test.runId) ?? [];
		const caseMode =
			test.executionMode === "script" || test.executionMode === "agent" ? test.executionMode : null;
		list.push({
			id: test.id,
			runId: test.runId,
			caseId: test.caseId,
			status: test.status as RunTestStatus,
			executionMode: caseMode,
			error: test.error,
			startedAt: test.startedAt,
			finishedAt: test.finishedAt,
			recording: recordingFromRow(test, settledByRunId.get(test.runId) ?? false),
		});
		testsByRunId.set(test.runId, list);
	}

	return runRows.map((runRow) => ({
		id: runRow.id,
		appId: runRow.appId,
		deviceId: runRow.deviceId,
		platform: runRow.platform as Run["platform"],
		buildId: runRow.buildId,
		status: runRow.status as RunStatus,
		executionMode: parseRunExecutionMode(runRow.executionMode),
		screenMode: parseRunScreenMode(runRow.screenMode),
		lane: runRow.lane === "direct" || runRow.lane === "appium" ? runRow.lane : undefined,
		laneWarning: runRow.laneWarning ?? undefined,
		error: runRow.error,
		createdAt: runRow.createdAt,
		startedAt: runRow.startedAt,
		finishedAt: runRow.finishedAt,
		tests: testsByRunId.get(runRow.id) ?? [],
	}));
}

export async function deleteRun(runId: string): Promise<void> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}

	if (!TERMINAL_RUN_STATUSES.has(run.status)) {
		const control = runControls.get(runId);
		if (control) {
			control.aborted = true;
		} else {
			runControls.set(runId, { aborted: true });
		}
		await persistCancelled(runId);
	}

	clearControl(runId);
	const db = getCatalogDb();
	await db.delete(runs).where(eq(runs.id, runId));
	for (const test of run.tests) await deleteRunVideo(test.id);
}

export async function cancelRun(runId: string): Promise<Run> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}

	if (TERMINAL_RUN_STATUSES.has(run.status)) {
		return run;
	}

	const control = runControls.get(runId);
	if (control) {
		control.aborted = true;
	} else {
		// Queued but executeRun not registered yet — register aborted control so executeRun exits early.
		runControls.set(runId, { aborted: true });
	}

	await persistCancelled(runId);
	return getRun(runId);
}

export async function getRunStepScreenshotPath(runId: string, stepId: string): Promise<string> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}

	for (const test of run.tests) {
		const step = test.steps?.find((item) => item.id === stepId);
		if (!step) continue;
		if (!step.screenshotUri || !existsSync(step.screenshotUri)) {
			throw new RunNotFoundError("Screenshot not found");
		}
		return step.screenshotUri;
	}

	throw new RunNotFoundError("Step not found");
}

/** Delete one case's video and forget its recording. Only once the Run has finished. */
export async function deleteRunTestVideo(
	runId: string,
	runTestId: string,
	videoDir: string = RUN_VIDEO_DIR,
): Promise<void> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}
	if (!run.tests.some((item) => item.id === runTestId)) {
		throw new RunNotFoundError("Test not found");
	}
	if (!TERMINAL_RUN_STATUSES.has(run.status)) {
		throw new RunValidationError("Wait for the run to finish before deleting its video");
	}
	await deleteRunVideo(runTestId, videoDir);
	await getCatalogDb()
		.update(runTests)
		.set({ recordingStatus: null, recordingNote: null })
		.where(eq(runTests.id, runTestId));
}

/** A video is only handed out once the Run has finished. */
export async function getRunTestVideoPath(
	runId: string,
	runTestId: string,
	videoDir: string = RUN_VIDEO_DIR,
): Promise<string> {
	const run = await loadRun(runId);
	if (!run) {
		throw new RunNotFoundError("Run not found");
	}
	const test = run.tests.find((item) => item.id === runTestId);
	if (!test) {
		throw new RunNotFoundError("Test not found");
	}
	const path = TERMINAL_RUN_STATUSES.has(run.status)
		? readyVideoPath(runTestId, test.recording?.status, videoDir)
		: null;
	if (!path) {
		throw new RunNotFoundError("Video not found");
	}
	return path;
}

/**
 * At startup nothing is executing, so a case still marked `recording` lost its runner mid-case.
 * Mark it unavailable so it does not read as recording forever.
 */
export async function recoverInterruptedRecordings(): Promise<void> {
	await getCatalogDb()
		.update(runTests)
		.set({ recordingStatus: "unavailable", recordingNote: CUT_OFF_NOTE })
		.where(eq(runTests.recordingStatus, "recording"));
}
