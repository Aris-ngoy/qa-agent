import { existsSync } from "node:fs";
import type {
	CreateRunRequest,
	Run,
	RunStatus,
	RunStep,
	RunTest,
	RunTestStatus,
} from "@yoqa/runner-client";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { installBuildOnDevice, resolveBuildForRun } from "../builds/application";
import { getApp, getCase } from "../catalog/application";
import { getCatalogDb } from "../catalog/db";
import { cases } from "../catalog/schema";
import { type ActiveProviderAuth, resolveActiveProviderAuth } from "../providers/application";
import {
	type AgentDecision,
	AgentProviderError,
	assertVisionCapableProvider,
	decideNextAction,
	isAbsurdNoScreenshotFail,
} from "./agent";
import { runSteps, runTests, runs } from "./schema";
import { type DeviceSession, createDeviceSession } from "./session";

const MAX_STEPS_PER_CASE = 25;
/** Let splash / nav transitions settle before the next screenshot. */
const POST_ACTION_SETTLE_MS = 800;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type RunControl = {
	aborted: boolean;
};

const runControls = new Map<string, RunControl>();

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["passed", "errored", "cancelled"]);

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
			createdAt: step.createdAt,
		}));
		tests.push({
			id: test.id,
			runId: test.runId,
			caseId: test.caseId,
			status: test.status as RunTestStatus,
			error: test.error,
			startedAt: test.startedAt,
			finishedAt: test.finishedAt,
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
		createdAt: Date.now(),
	});
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
				})
				.where(eq(runTests.id, test.id));
		}
	}
}

async function executeCase(input: {
	runId: string;
	runTestId: string;
	caseId: string;
	appContext: string;
	session: DeviceSession;
	auth: ActiveProviderAuth;
}): Promise<"passed" | "errored" | "cancelled"> {
	const db = getCatalogDb();
	const catalogCase = await getCase(input.caseId);
	if (!catalogCase) {
		throw new RunValidationError(`Case not found: ${input.caseId}`);
	}

	if (isAborted(input.runId)) {
		return "cancelled";
	}

	const startedAt = Date.now();
	await db
		.update(runTests)
		.set({ status: "running", startedAt, error: null })
		.where(eq(runTests.id, input.runTestId));

	let stepIdx = 0;
	let caseStatus: "passed" | "errored" | "cancelled" = "passed";
	let caseError: string | null = null;
	let lastScreenshotUri: string | null = null;

	try {
		const flows =
			catalogCase.flows.length > 0
				? catalogCase.flows
				: [{ id: "empty", instructions: "", expectedResult: "", flowId: null }];

		for (const flow of flows) {
			if (isAborted(input.runId)) {
				caseStatus = "cancelled";
				break;
			}

			const recentActions: AgentDecision[] = [];
			let flowDone = false;
			for (let attempt = 0; attempt < MAX_STEPS_PER_CASE && !flowDone; attempt++) {
				if (isAborted(input.runId)) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				const shotStarted = Date.now();
				const shot = await input.session.screenshot();
				lastScreenshotUri = shot.path;

				if (isAborted(input.runId)) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				let decision = await decideNextAction({
					auth: input.auth,
					appContext: input.appContext,
					caseTitle: catalogCase.name,
					instructions: flow.instructions,
					expectedResult: flow.expectedResult,
					stepIndex: stepIdx,
					imageBase64: shot.base64,
					recentActions,
				});

				// Vision models occasionally claim the image is missing; retry once.
				if (isAbsurdNoScreenshotFail(decision)) {
					decision = await decideNextAction({
						auth: input.auth,
						appContext: input.appContext,
						caseTitle: catalogCase.name,
						instructions: flow.instructions,
						expectedResult: flow.expectedResult,
						stepIndex: stepIdx,
						imageBase64: shot.base64,
						recentActions,
					});
					if (isAbsurdNoScreenshotFail(decision)) {
						decision = {
							type: "fail",
							reason:
								"Model ignored the attached screenshot (claimed none was provided). Try a stronger vision model in Settings → Provider.",
							thoughts:
								"The vision model returned fail claiming no screenshot was available even though an image was attached to the request. After one retry it still denied the screenshot, so the step was marked failed.",
						};
					}
				}

				const latencyMs = Date.now() - shotStarted;

				if (isAborted(input.runId)) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				recentActions.push(decision);

				if (decision.type === "tap") {
					const x = decision.x ?? 500;
					const y = decision.y ?? 500;
					await input.session.tap(x, y);
					await sleep(POST_ACTION_SETTLE_MS);
					await appendStep({
						runTestId: input.runTestId,
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
				} else if (decision.type === "type") {
					await input.session.type(decision.text ?? "");
					await sleep(POST_ACTION_SETTLE_MS);
					await appendStep({
						runTestId: input.runTestId,
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
				} else if (decision.type === "wait") {
					const waitMs = Math.min(3000, Math.max(500, decision.ms ?? 1500));
					await sleep(waitMs);
					await appendStep({
						runTestId: input.runTestId,
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? `wait ${waitMs}ms`,
					});
				} else if (decision.type === "verify" || decision.type === "done") {
					await appendStep({
						runTestId: input.runTestId,
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
					flowDone = true;
				} else {
					await appendStep({
						runTestId: input.runTestId,
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: false,
						latencyMs,
						detail: decision.reason ?? "Agent failed the step",
					});
					caseStatus = "errored";
					caseError = decision.reason ?? "Agent marked the flow as failed";
					flowDone = true;
				}

				stepIdx += 1;
			}

			if (caseStatus === "errored" || caseStatus === "cancelled") break;
			if (!flowDone) {
				caseStatus = "errored";
				caseError = `Exceeded max steps (${MAX_STEPS_PER_CASE}) for a flow`;
				break;
			}
		}
	} catch (error) {
		if (isAborted(input.runId)) {
			caseStatus = "cancelled";
		} else {
			caseStatus = "errored";
			caseError = error instanceof Error ? error.message : String(error);
			await appendStep({
				runTestId: input.runTestId,
				idx: stepIdx,
				action: {
					type: "fail",
					reason: caseError,
					thoughts: `The run stopped because of an error: ${caseError}`,
				},
				screenshotUri: lastScreenshotUri,
				ok: false,
				latencyMs: 0,
				detail: caseError,
			});
		}
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
		})
		.where(eq(runTests.id, input.runTestId));
	await updateCaseLastRun(input.caseId, caseStatus, finishedAt);
	return caseStatus;
}

export async function executeRun(runId: string): Promise<void> {
	const db = getCatalogDb();
	const run = await loadRun(runId);
	if (!run) return;

	registerControl(runId);

	let session: DeviceSession | null = null;
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

		const auth = await assertVisionCapableProvider(await resolveActiveProviderAuth());
		const app = await getApp(run.appId);
		if (!app) {
			throw new RunValidationError("App not found");
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
		session = await createDeviceSession({
			platform: run.platform,
			deviceId: run.deviceId,
			appCaps: app.capabilities,
			caseCaps: firstCase?.capabilities ?? [],
			bundleId: app.iosBundleId || undefined,
			appPackage: app.androidApplicationId || undefined,
		});

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

			const status = await executeCase({
				runId,
				runTestId: test.id,
				caseId: test.caseId,
				appContext: app.context,
				session,
				auth,
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
			await session.quit().catch(() => undefined);
		}
		clearControl(runId);
	}
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
	const uniqueCaseIds = [...new Set(input.caseIds)];
	if (uniqueCaseIds.length === 0) {
		throw new RunValidationError("At least one case id is required");
	}

	const app = await getApp(input.appId);
	if (!app) {
		throw new RunValidationError("App not found");
	}

	for (const caseId of uniqueCaseIds) {
		const catalogCase = await getCase(caseId);
		if (!catalogCase) {
			throw new RunValidationError(`Case not found: ${caseId}`);
		}
		if (catalogCase.appId !== input.appId) {
			throw new RunValidationError(`Case ${caseId} does not belong to app ${input.appId}`);
		}
	}

	try {
		await assertVisionCapableProvider(await resolveActiveProviderAuth());
	} catch (error) {
		if (error instanceof AgentProviderError) {
			throw new RunValidationError(error.message);
		}
		throw error;
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
		list.push({
			id: test.id,
			runId: test.runId,
			caseId: test.caseId,
			status: test.status as RunTestStatus,
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
