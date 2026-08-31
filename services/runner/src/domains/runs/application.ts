import { existsSync } from "node:fs";
import type {
	CreateRunRequest,
	Run,
	RunExecutionMode,
	RunStatus,
	RunStep,
	RunTest,
	RunTestStatus,
} from "@yoqa/runner-client";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { installBuildOnDevice, resolveBuildForRun } from "../builds/application";
import { getApp, getCase, getCaseScriptJson, saveCaseScript } from "../catalog/application";
import { getCatalogDb } from "../catalog/db";
import { cases } from "../catalog/schema";
import { acquireSessionForRun, releaseSessionFromRun } from "../devices/active-session";
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

function resolveCaseExecutionMode(
	runMode: RunExecutionMode,
	hasScript: boolean,
): "script" | "agent" {
	if (runMode === "agent") return "agent";
	if (hasScript) return "script";
	return "agent";
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
	session: DeviceSession;
	auth: ActiveProviderAuth;
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
		clock: { sleep, now: () => Date.now() },
	});
}

async function executeCase(input: {
	runId: string;
	runTestId: string;
	caseId: string;
	appContext: string;
	session: DeviceSession;
	auth: ActiveProviderAuth | null;
	caseMode: "script" | "agent";
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
			session: input.session,
			auth: input.auth,
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
		});
		session = acquired.session;
		sharedSession = acquired.shared;

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

			const status = await executeCase({
				runId,
				runTestId: test.id,
				caseId: test.caseId,
				appContext: app.context,
				session,
				auth,
				caseMode,
			});
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
