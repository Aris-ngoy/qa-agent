import { existsSync } from "node:fs";
import type {
	BrowserProfile,
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
import {
	browserProfileSchema,
	installedBrowserId,
	runStepActionSchema,
	startTargetRequest,
	stepPhasesSchema,
	viewportPresetSchema,
	webDeviceOf,
} from "@yoqa/runner-client";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { resolveBuildForRun } from "../builds/application";
import {
	getApp,
	getCase,
	getCaseScriptJson,
	isEverydayWarningAccepted,
	saveCaseScript,
} from "../catalog/application";
import { getCatalogDb } from "../catalog/db";
import { cases } from "../catalog/schema";
import { acquireSessionForRun, releaseSessionFromRun } from "../devices/active-session";
import { EVERYDAY_WARNING } from "../devices/everyday-warning";
import { pruneOldRunScreenshots } from "../devices/screenshot-retention";
import type { DeviceSession } from "../devices/session";
import { type ActiveProviderAuth, resolveActiveProviderAuth } from "../providers/application";
import { AgentProviderError, assertVisionCapableProvider } from "./agent";
import { caseModeFor, executeCase } from "./case-executor";
import { RunNotFoundError, RunValidationError } from "./errors";
import { reportedLane, reportedLaneWarning } from "./legacy-lane";
import {
	CUT_OFF_NOTE,
	RUN_VIDEO_DIR,
	deleteRunVideo,
	readyVideoPath,
	recordCase,
	recordingFromRow,
	runVideoPath,
} from "./run-recording";
import { type PlannedCase, openStartTarget, prepareRun, runProfileOf } from "./run-setup";
import { runSteps, runTests, runs } from "./schema";
import { parseCaseScript, serializeCaseScript } from "./script";

export { RunNotFoundError, RunValidationError };

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["passed", "errored", "cancelled"]);

type RunControl = {
	aborted: boolean;
};

const runControls = new Map<string, RunControl>();

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

function parseAction(raw: string): RunStep["action"] {
	try {
		return runStepActionSchema.parse(JSON.parse(raw));
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

/** The Viewport preset a web Run stored; nothing for other platforms or an unknown name. */
function viewportOf(value: string | null): Pick<Run, "viewport"> {
	const parsed = viewportPresetSchema.safeParse(value);
	return parsed.success ? { viewport: parsed.data } : {};
}

/** The browser profile a web Run stored; nothing for other platforms or an unknown name. */
function profileOf(value: string | null): Pick<Run, "profile"> {
	const parsed = browserProfileSchema.safeParse(value);
	return parsed.success ? { profile: parsed.data } : {};
}

/** The browser profile a web Run on these cases would open (`runProfileOf`), before it exists. */
async function resolveRunProfile(
	requested: string | null | undefined,
	caseIds: string[],
): Promise<BrowserProfile> {
	const scripts: Array<ReturnType<typeof parseCaseScript>> = [];
	for (const caseId of caseIds) scripts.push(parseCaseScript(await getCaseScriptJson(caseId)));
	return runProfileOf(requested, scripts);
}

/**
 * A Run on the Everyday browser needs its App to have accepted the first-use warning, at a
 * connect, and cannot be clean: Yoqa never wipes the user's own profile.
 */
async function assertEverydayRunAllowed(input: CreateRunRequest, caseIds: string[]): Promise<void> {
	if (!(await isEverydayWarningAccepted(input.appId))) {
		throw new RunValidationError(
			`${EVERYDAY_WARNING} Connect to ${input.deviceId} for this App once and accept the warning before a Run uses it.`,
		);
	}
	if ((await resolveRunProfile(input.profile, caseIds)) === "clean") {
		const browser = webDeviceOf(input.deviceId)?.browser;
		const launched = browser ? installedBrowserId(browser.browser) : input.deviceId;
		throw new RunValidationError(
			`${input.deviceId} is your Everyday browser, which Yoqa never wipes, so a Run there cannot use a clean profile. For a clean start, run on ${launched}, which Yoqa launches on the App's Kept profile, with profile clean or after resetting the Kept profile (yoqa devices web reset-profile).`,
		);
	}
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

	return runFromRow(runRow, tests);
}

function runFromRow(runRow: typeof runs.$inferSelect, tests: RunTest[]): Run {
	return {
		id: runRow.id,
		appId: runRow.appId,
		deviceId: runRow.deviceId,
		platform: runRow.platform as Run["platform"],
		buildId: runRow.buildId,
		status: runRow.status as RunStatus,
		executionMode: parseRunExecutionMode(runRow.executionMode),
		screenMode: parseRunScreenMode(runRow.screenMode),
		lane: reportedLane(runRow.lane),
		laneWarning: reportedLaneWarning(runRow.laneWarning),
		...(runRow.browser ? { browser: runRow.browser } : {}),
		...(runRow.browserProfileName ? { browserProfileName: runRow.browserProfileName } : {}),
		...viewportOf(runRow.viewport),
		...profileOf(runRow.profile),
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

async function persistCancelled(runId: string, reason = "Cancelled by user"): Promise<void> {
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
					error: reason,
					finishedAt,
					currentCommand: null,
				})
				.where(eq(runTests.id, test.id));
		}
	}
}

/** A finished Run: passed unless a case errored, with its Lane's latest warning (ADR-0004). */
async function persistFinished(
	runId: string,
	anyFailed: boolean,
	session: DeviceSession | null,
): Promise<void> {
	await getCatalogDb()
		.update(runs)
		.set({
			status: anyFailed ? "errored" : "passed",
			finishedAt: Date.now(),
			error: null,
			...(session ? { laneWarning: session.laneWarning ?? null } : {}),
		})
		.where(eq(runs.id, runId));
}

/** A Run that could not go on: it and every case not yet finished error with `error`. */
async function persistErrored(
	runId: string,
	error: unknown,
	session: DeviceSession | null,
): Promise<void> {
	const db = getCatalogDb();
	const message = error instanceof Error ? error.message : String(error);
	const finishedAt = Date.now();
	await db
		.update(runs)
		.set({
			status: "errored",
			error: message,
			finishedAt,
			...(session ? { laneWarning: session.laneWarning ?? null } : {}),
		})
		.where(eq(runs.id, runId));

	const current = await loadRun(runId);
	for (const test of current?.tests ?? []) {
		if (test.status === "queued" || test.status === "running") {
			await db
				.update(runTests)
				.set({ status: "errored", error: message, finishedAt })
				.where(eq(runTests.id, test.id));
			await updateCaseLastRun(test.caseId, "errored", finishedAt);
		}
	}
}

async function saveCaseRecording(runTestId: string, state: RunRecording): Promise<void> {
	await getCatalogDb()
		.update(runTests)
		.set({ recordingStatus: state.status, recordingNote: state.note ?? null })
		.where(eq(runTests.id, runTestId));
}

/** What every case of one Run shares when the Case executor runs it. */
type RunCaseContext = {
	runId: string;
	session: DeviceSession;
	auth: ActiveProviderAuth | null;
	appContext: string;
	appKnowledge?: string;
	screenMode: RunScreenMode;
	defaultAppId?: string;
	/** The Run asked to record every case; otherwise each case decides for itself. */
	recordAll: boolean;
};

/**
 * Run one planned Test Case through the Case executor, recorded when asked, and persist
 * its outcome: its row, its case's last run, and the Case Script a passed agent case learns.
 * A cancelled case is left to `persistCancelled`.
 */
async function runTest(
	planned: PlannedCase,
	context: RunCaseContext,
): Promise<"passed" | "errored" | "cancelled"> {
	const db = getCatalogDb();
	const { test, catalogCase, mode } = planned;
	if (!catalogCase) {
		await db
			.update(runTests)
			.set({ status: "errored", error: "Case not found", finishedAt: Date.now() })
			.where(eq(runTests.id, test.id));
		return "errored";
	}

	const status = await recordCase(
		context.session,
		runVideoPath(test.id),
		{
			enabled: context.recordAll || catalogCase.recordVideo,
			onState: (state) => saveCaseRecording(test.id, state),
		},
		async () => {
			if (isAborted(context.runId)) return "cancelled";
			await db
				.update(runTests)
				.set({
					status: "running",
					startedAt: Date.now(),
					error: null,
					executionMode: mode,
					currentCommand: null,
				})
				.where(eq(runTests.id, test.id));

			const outcome = await executeCase({
				catalogCase,
				mode,
				runId: context.runId,
				auth: context.auth,
				session: context.session,
				appContext: context.appContext,
				appKnowledge: context.appKnowledge,
				screenMode: context.screenMode,
				defaultAppId: context.defaultAppId,
				isAborted: () => isAborted(context.runId),
				appendStep: (step) => appendStep({ runTestId: test.id, ...step }),
				setCurrentCommand: (command) => setCurrentCommand(test.id, command),
			});
			if (isAborted(context.runId) || outcome.status === "cancelled") return "cancelled";

			const finishedAt = Date.now();
			await db
				.update(runTests)
				.set({
					status: outcome.status,
					error: outcome.error,
					finishedAt,
					currentCommand: null,
				})
				.where(eq(runTests.id, test.id));
			await updateCaseLastRun(test.caseId, outcome.status, finishedAt);
			const learned = outcome.learnedScript;
			if (learned) {
				await saveCaseScript(test.caseId, serializeCaseScript(learned), learned.savedAt);
			}
			return outcome.status;
		},
	);
	// The Run was deleted while this case was recording; do not leave its video behind.
	if (!(await loadRun(context.runId))) await deleteRunVideo(test.id);
	return status;
}

/**
 * Load → acquire the Device Session → run each Test Case through the Case executor →
 * persist → release. A cancel at any point persists the Run as cancelled.
 */
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

		await db
			.update(runs)
			.set({ status: "running", startedAt: Date.now(), error: null })
			.where(eq(runs.id, runId));

		// Reclaim old run evidence in the background; never blocks or fails a run.
		void pruneOldRunScreenshots();

		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}

		const { app, startTarget, cases: planned, auth } = await prepareRun(run);

		const runRow = (await db.select().from(runs).where(eq(runs.id, runId)))[0];
		const requestedLane = runRow?.requestedLane;
		// The Everyday browser runs on the user's own profile: neither a Kept one nor clean.
		const everyday = webDeviceOf(run.deviceId)?.kind === "everyday";
		const profile =
			run.platform === "web" && !everyday
				? runProfileOf(
						runRow?.requestedProfile,
						planned.map((item) => item.catalogCase?.script),
					)
				: undefined;
		// Adopt the shared Active Session when it already targets this device (on web, on
		// this App's profile and the preset asked for); otherwise connect (replacing any unheld
		// session) and keep it live after.
		const acquired = await acquireSessionForRun({
			runId,
			deviceId: run.deviceId,
			platform: run.platform,
			...startTargetRequest(run.platform, startTarget),
			requestedLane:
				requestedLane === "direct" || requestedLane === "auto" ? requestedLane : undefined,
			...(profile ? { appId: run.appId, profile } : {}),
			...viewportOf(runRow?.requestedViewport ?? null),
		});
		const activeSession = acquired.session;
		session = activeSession;
		sharedSession = acquired.shared;
		await db
			.update(runs)
			.set({
				lane: session.lane,
				laneWarning: session.laneWarning ?? null,
				browser:
					session.browser && everyday ? `Everyday ${session.browser}` : (session.browser ?? null),
				browserProfileName: session.browserProfileName ?? null,
				viewport: session.viewport ?? null,
				profile: profile ?? null,
			})
			.where(eq(runs.id, runId));
		await openStartTarget(session, run.platform, startTarget);

		const context: RunCaseContext = {
			runId,
			session: activeSession,
			auth,
			appContext: app.context,
			appKnowledge: app.knowledge,
			screenMode: run.screenMode ?? "tree",
			defaultAppId: startTarget,
			recordAll: runRow?.recordVideo === 1,
		};
		let anyFailed = false;
		for (const item of planned) {
			if (isAborted(runId)) {
				await persistCancelled(runId);
				return;
			}
			const status = await runTest(item, context);
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
		await persistFinished(runId, anyFailed, session);
	} catch (error) {
		if (isAborted(runId)) {
			await persistCancelled(runId);
			return;
		}
		await persistErrored(runId, error, session);
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

	if (input.viewport && input.platform !== "web") {
		throw new RunValidationError("viewport is for web Runs: a phone's screen is its own size");
	}

	if (webDeviceOf(input.deviceId)?.kind === "everyday") {
		await assertEverydayRunAllowed(input, uniqueCaseIds);
	}

	const needsAgent = catalogCases.some(
		(catalogCase) => caseModeFor(executionMode, catalogCase.hasScript) === "agent",
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
		requestedProfile: input.profile ?? null,
		requestedViewport: input.viewport ?? null,
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

	return runRows.map((runRow) => runFromRow(runRow, testsByRunId.get(runRow.id) ?? []));
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

/**
 * The runner is stopping: cancel every Run in progress, so a restart does not find one
 * left `running`. Its cases still queued or running say the runner stopped.
 */
export async function cancelRunsInProgress(): Promise<void> {
	for (const [runId, control] of runControls) {
		control.aborted = true;
		await persistCancelled(runId, "The runner stopped");
	}
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
