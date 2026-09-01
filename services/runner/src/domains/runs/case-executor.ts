import {
	type ActionRequest,
	type ActionResponse,
	type CaseScript,
	type CatalogCase,
	type ScreenElement,
	formatActionShellLine,
	formatAssertShellLine,
	formatSleepShellLine,
	screenHasText,
} from "@yoqa/runner-client";
import {
	ActionNotFoundError,
	ActionValidationError,
	performAction as defaultPerformAction,
	getScreen,
} from "../devices/interaction";
import { type DeviceSession, isDeadSessionError } from "../devices/session";
import type { ActiveProviderAuth } from "../providers/application";
import {
	type AgentDecision,
	coerceScrollIntentToSwipe,
	continueScrollingInsteadOfComplete,
	decisionToActionRequest,
	decideNextAction as defaultDecideNextAction,
	flattenCaseInstructions,
	formatScreenSnapshot,
	isAbsurdNoScreenshotFail,
	screenshotFingerprint,
} from "./agent";

/** Max vision/action iterations for the current instruction (not the whole case). */
export const MAX_STEPS_PER_CASE = 25;
/** Let splash / nav transitions settle before the next screenshot. */
export const POST_ACTION_SETTLE_MS = 800;

export type AppendCaseStep = (input: {
	idx: number;
	action: unknown;
	screenshotUri: string | null;
	ok: boolean;
	latencyMs: number;
	detail: string | null;
	command: string | null;
}) => Promise<void>;

export type SetCurrentCommand = (command: string | null) => Promise<void>;

export type CaseDecideFn = (input: {
	auth: ActiveProviderAuth;
	appContext: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	imageBase64: string;
	recentActions?: AgentDecision[];
	screenSnapshot?: string;
	lastError?: string;
	defaultAppId?: string;
	completedInstructions?: string[];
	instructionOrdinal?: number;
	instructionCount?: number;
}) => Promise<AgentDecision>;

export type PerformActionFn = (
	session: DeviceSession,
	body: ActionRequest,
) => Promise<ActionResponse>;

export type CaseExecutorClock = {
	sleep: (ms: number) => Promise<void>;
	now: () => number;
};

export type ScriptCaseDeps = {
	script: CaseScript;
	session: DeviceSession;
	isAborted: () => boolean;
	appendStep: AppendCaseStep;
	setCurrentCommand?: SetCurrentCommand;
	performAction?: PerformActionFn;
	readScreen?: (session: DeviceSession) => Promise<{ elements?: ScreenElement[] }>;
	clock?: CaseExecutorClock;
	settleMs?: number;
};

export type AgentCaseDeps = {
	catalogCase: CatalogCase;
	appContext: string;
	auth: ActiveProviderAuth;
	session: DeviceSession;
	isAborted: () => boolean;
	appendStep: AppendCaseStep;
	setCurrentCommand?: SetCurrentCommand;
	decide?: CaseDecideFn;
	performAction?: PerformActionFn;
	readScreen?: (session: DeviceSession) => Promise<{ elements?: ScreenElement[] }>;
	clock?: CaseExecutorClock;
	settleMs?: number;
	maxStepsPerCase?: number;
	defaultAppId?: string;
};

const defaultClock: CaseExecutorClock = {
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

const noopSetCurrentCommand: SetCurrentCommand = async () => {};

async function withCurrentCommand(
	setCurrentCommand: SetCurrentCommand,
	command: string | null,
	work: () => Promise<void>,
): Promise<void> {
	await setCurrentCommand(command);
	try {
		await work();
	} finally {
		await setCurrentCommand(null);
	}
}

function isRetriableActionError(error: unknown): boolean {
	return error instanceof ActionNotFoundError || error instanceof ActionValidationError;
}

async function readCleanedTree(
	readScreen: (session: DeviceSession) => Promise<{ elements?: ScreenElement[] }>,
	session: DeviceSession,
): Promise<{ snapshot: string; elements: ScreenElement[] }> {
	try {
		const screen = await readScreen(session);
		const elements = screen.elements ?? [];
		return { snapshot: formatScreenSnapshot(elements), elements };
	} catch (error) {
		if (isDeadSessionError(error)) throw error;
		const message = error instanceof Error ? error.message : String(error);
		return { snapshot: `(screen tree unavailable: ${message})`, elements: [] };
	}
}

async function runTextAssert(input: {
	session: DeviceSession;
	readScreen: (session: DeviceSession) => Promise<{ elements?: ScreenElement[] }>;
	clock: CaseExecutorClock;
	isAborted: () => boolean;
	assertion: "visible" | "not-visible";
	text: string;
	timeoutMs: number;
}): Promise<void> {
	const deadline = input.clock.now() + input.timeoutMs;
	for (;;) {
		if (input.isAborted()) {
			throw new Error("Aborted");
		}
		const screen = await input.readScreen(input.session);
		const found = screenHasText(screen.elements, input.text);
		if (input.assertion === "visible" && found) return;
		if (input.assertion === "not-visible" && !found) return;
		if (input.clock.now() >= deadline) {
			throw new Error(
				input.assertion === "visible"
					? `Expected visible text not found within ${Math.round(input.timeoutMs / 1000)}s: ${input.text}`
					: `Unexpected text still visible after ${Math.round(input.timeoutMs / 1000)}s: ${input.text}`,
			);
		}
		await input.clock.sleep(400);
	}
}

function commandForDecision(decision: AgentDecision, defaultAppId?: string): string | null {
	if (decision.type === "verify" || decision.type === "done" || decision.type === "fail") {
		return null;
	}
	if (decision.type === "wait") {
		const waitMs = Math.min(3000, Math.max(500, decision.ms ?? 1500));
		return formatSleepShellLine(waitMs / 1000);
	}
	if (decision.type === "assert") {
		const assertion = decision.assertion === "not-visible" ? "not-visible" : "visible";
		const timeoutMs = Math.min(60_000, Math.max(1_000, decision.timeoutMs ?? 5_000));
		return formatAssertShellLine({
			assertion,
			text: decision.text ?? "",
			timeoutSeconds: timeoutMs / 1000,
		});
	}
	const body = decisionToActionRequest(decision, { defaultAppId });
	return body ? formatActionShellLine(body) : null;
}

/**
 * Replay a saved Case Script against an injected Device Session.
 * Taps/types go through `performAction` (same path as the connector).
 */
export async function executeScriptCase(
	deps: ScriptCaseDeps,
): Promise<"passed" | "errored" | "cancelled"> {
	const perform = deps.performAction ?? defaultPerformAction;
	const readScreen =
		deps.readScreen ??
		(async (session) => {
			const screen = await getScreen(session, { full: false });
			return { elements: screen.elements };
		});
	const clock = deps.clock ?? defaultClock;
	const settleMs = deps.settleMs ?? POST_ACTION_SETTLE_MS;
	const setCurrentCommand = deps.setCurrentCommand ?? noopSetCurrentCommand;

	let stepIdx = 0;
	let lastScreenshotUri: string | null = null;

	try {
		for (const action of deps.script.actions) {
			if (deps.isAborted()) {
				return "cancelled";
			}

			const shotStarted = clock.now();
			const shot = await deps.session.screenshot();
			lastScreenshotUri = shot.path;
			const latencyMs = clock.now() - shotStarted;

			if (deps.isAborted()) {
				return "cancelled";
			}

			if (action.type === "tap") {
				const tapBody: ActionRequest = { kind: "tap" };
				if (action.label) tapBody.label = action.label;
				if (action.id) tapBody.id = action.id;
				if (action.x != null) tapBody.x = action.x;
				if (action.y != null) tapBody.y = action.y;
				if (action.double) tapBody.double = true;
				if (action.durationMs != null) tapBody.durationMs = action.durationMs;
				const command = formatActionShellLine(tapBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, tapBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "tap",
							x: action.x,
							y: action.y,
							label: action.label,
							id: action.id,
							reason: action.reason ?? "Replayed saved script tap",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? action.label ?? action.id ?? null,
						command,
					});
				});
			} else if (action.type === "swipe") {
				const swipeBody: ActionRequest = {
					kind: "swipe",
					x: action.x,
					y: action.y,
					x2: action.x2,
					y2: action.y2,
					...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
				};
				const command = formatActionShellLine(swipeBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, swipeBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "swipe",
							x: action.x,
							y: action.y,
							x2: action.x2,
							y2: action.y2,
							durationMs: action.durationMs,
							reason: action.reason ?? "Replayed saved script swipe",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? null,
						command,
					});
				});
			} else if (action.type === "drag") {
				const dragBody: ActionRequest = {
					kind: "drag",
					x: action.x,
					y: action.y,
					x2: action.x2,
					y2: action.y2,
					...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
				};
				const command = formatActionShellLine(dragBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, dragBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "drag",
							x: action.x,
							y: action.y,
							x2: action.x2,
							y2: action.y2,
							durationMs: action.durationMs,
							reason: action.reason ?? "Replayed saved script drag",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? null,
						command,
					});
				});
			} else if (
				action.type === "activate-app" ||
				action.type === "terminate-app" ||
				action.type === "restart-app"
			) {
				const appBody: ActionRequest = { kind: action.type, appId: action.appId };
				const command = formatActionShellLine(appBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, appBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: action.type,
							appId: action.appId,
							reason: action.reason ?? `Replayed saved script ${action.type}`,
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? action.appId,
						command,
					});
				});
			} else if (action.type === "background-app") {
				const backgroundBody: ActionRequest = {
					kind: "background-app",
					...(action.seconds != null ? { seconds: action.seconds } : {}),
				};
				const command = formatActionShellLine(backgroundBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, backgroundBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "background-app",
							seconds: action.seconds,
							reason: action.reason ?? "Replayed saved script background-app",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? null,
						command,
					});
				});
			} else if (action.type === "open-url") {
				const urlBody: ActionRequest = { kind: "open-url", url: action.url };
				const command = formatActionShellLine(urlBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, urlBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "open-url",
							url: action.url,
							reason: action.reason ?? "Replayed saved script open-url",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? action.url,
						command,
					});
				});
			} else if (action.type === "type") {
				const typeBody: ActionRequest = { kind: "input", text: action.text };
				const command = formatActionShellLine(typeBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, typeBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "type",
							text: action.text,
							reason: action.reason ?? "Replayed saved script type",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? null,
						command,
					});
				});
			} else if (action.type === "assert") {
				const timeoutMs = action.timeoutMs ?? 5_000;
				const assertion = action.assertion;
				const command = formatAssertShellLine({
					assertion,
					text: action.text,
					timeoutSeconds: timeoutMs / 1000,
				});
				await withCurrentCommand(setCurrentCommand, command, async () => {
					const deadline = clock.now() + timeoutMs;
					for (;;) {
						if (deps.isAborted()) {
							return;
						}
						const screen = await readScreen(deps.session);
						const found = screenHasText(screen.elements, action.text);
						if (assertion === "visible" && found) break;
						if (assertion === "not-visible" && !found) break;
						if (clock.now() >= deadline) {
							throw new Error(
								assertion === "visible"
									? `Expected visible text not found within ${Math.round(timeoutMs / 1000)}s: ${action.text}`
									: `Unexpected text still visible after ${Math.round(timeoutMs / 1000)}s: ${action.text}`,
							);
						}
						await clock.sleep(400);
					}
					if (deps.isAborted()) {
						return;
					}
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "assert",
							assertion,
							text: action.text,
							timeoutMs,
							reason: action.reason ?? `Assert ${assertion}: ${action.text}`,
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? `${assertion}: ${action.text}`,
						command,
					});
				});
				if (deps.isAborted()) {
					return "cancelled";
				}
			} else if (action.type === "alert") {
				const alertBody: ActionRequest = {
					kind: "alert",
					alertAction: action.alertAction === "dismiss" ? "dismiss" : "accept",
				};
				const command = formatActionShellLine(alertBody);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await perform(deps.session, alertBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "alert",
							alertAction: action.alertAction === "dismiss" ? "dismiss" : "accept",
							reason: action.reason ?? "Replayed saved script alert",
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? action.alertAction ?? "accept",
						command,
					});
				});
			} else {
				const waitMs = Math.min(3000, Math.max(500, action.ms));
				const command = formatSleepShellLine(waitMs / 1000);
				await withCurrentCommand(setCurrentCommand, command, async () => {
					await clock.sleep(waitMs);
					await deps.appendStep({
						idx: stepIdx,
						action: {
							type: "wait",
							ms: waitMs,
							reason: action.reason ?? `wait ${waitMs}ms`,
							thoughts: "Replaying the saved script without calling the AI agent.",
						},
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: action.reason ?? `wait ${waitMs}ms`,
						command,
					});
				});
			}

			stepIdx += 1;
		}

		await deps.appendStep({
			idx: stepIdx,
			action: {
				type: "done",
				reason: "Saved script completed",
				thoughts: "All replayed script actions finished successfully.",
			},
			screenshotUri: lastScreenshotUri,
			ok: true,
			latencyMs: 0,
			detail: "Saved script completed",
			command: null,
		});

		return "passed";
	} catch (error) {
		if (deps.isAborted()) {
			return "cancelled";
		}
		const message = error instanceof Error ? error.message : String(error);
		await deps.appendStep({
			idx: stepIdx,
			action: {
				type: "fail",
				reason: message,
				thoughts: `Script replay stopped because of an error: ${message}`,
			},
			screenshotUri: lastScreenshotUri,
			ok: false,
			latencyMs: 0,
			detail: message,
			command: null,
		});
		return "errored";
	}
}

/**
 * Run one Test Case with an injected decide function against a Device Session.
 */
export async function executeAgentCase(deps: AgentCaseDeps): Promise<{
	status: "passed" | "errored" | "cancelled";
	decisions: AgentDecision[];
	error: string | null;
}> {
	const decide = deps.decide ?? defaultDecideNextAction;
	const perform = deps.performAction ?? defaultPerformAction;
	const readScreen =
		deps.readScreen ??
		(async (session) => {
			const screen = await getScreen(session, { full: false });
			return { elements: screen.elements };
		});
	const clock = deps.clock ?? defaultClock;
	const settleMs = deps.settleMs ?? POST_ACTION_SETTLE_MS;
	const maxSteps = deps.maxStepsPerCase ?? MAX_STEPS_PER_CASE;
	const setCurrentCommand = deps.setCurrentCommand ?? noopSetCurrentCommand;

	let stepIdx = 0;
	let caseStatus: "passed" | "errored" | "cancelled" = "passed";
	let caseError: string | null = null;
	let lastScreenshotUri: string | null = null;
	const recordedDecisions: AgentDecision[] = [];

	const decideOnce = async (input: {
		flow: { instructions: string; expectedResult: string };
		imageBase64: string;
		recentActions: AgentDecision[];
		screenSnapshot: string;
		lastError?: string;
		lastSwipeMovedScreen: boolean;
		completedInstructions: string[];
		instructionOrdinal: number;
		instructionCount: number;
	}): Promise<AgentDecision> => {
		const payload = {
			auth: deps.auth,
			appContext: deps.appContext,
			caseTitle: deps.catalogCase.name,
			instructions: input.flow.instructions,
			expectedResult: input.flow.expectedResult,
			stepIndex: stepIdx,
			imageBase64: input.imageBase64,
			recentActions: input.recentActions,
			screenSnapshot: input.screenSnapshot,
			lastError: input.lastError,
			defaultAppId: deps.defaultAppId,
			completedInstructions: [...input.completedInstructions],
			instructionOrdinal: input.instructionOrdinal,
			instructionCount: input.instructionCount,
		};
		let decision = await decide(payload);
		if (isAbsurdNoScreenshotFail(decision)) {
			decision = await decide(payload);
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
		decision = coerceScrollIntentToSwipe(decision);
		decision = continueScrollingInsteadOfComplete({
			decision,
			instructions: input.flow.instructions,
			expectedResult: input.flow.expectedResult,
			recentActions: input.recentActions,
			lastSwipeMovedScreen: input.lastSwipeMovedScreen,
		});
		if (
			(decision.type === "activate-app" ||
				decision.type === "terminate-app" ||
				decision.type === "restart-app") &&
			!decision.appId &&
			deps.defaultAppId
		) {
			decision = { ...decision, appId: deps.defaultAppId };
		}
		return decision;
	};

	const applyDecision = async (decision: AgentDecision): Promise<"continue" | "done" | "fail"> => {
		if (decision.type === "wait") {
			const waitMs = Math.min(3000, Math.max(500, decision.ms ?? 1500));
			await clock.sleep(waitMs);
			return "continue";
		}
		if (decision.type === "verify" || decision.type === "done") {
			return "done";
		}
		if (decision.type === "fail") {
			return "fail";
		}
		if (decision.type === "assert") {
			const assertion = decision.assertion === "not-visible" ? "not-visible" : "visible";
			const timeoutMs = Math.min(60_000, Math.max(1_000, decision.timeoutMs ?? 5_000));
			await runTextAssert({
				session: deps.session,
				readScreen,
				clock,
				isAborted: deps.isAborted,
				assertion,
				text: decision.text ?? "",
				timeoutMs,
			});
			return "continue";
		}
		const body = decisionToActionRequest(decision, { defaultAppId: deps.defaultAppId });
		if (!body) {
			throw new Error(`${decision.type} is missing required fields`);
		}
		try {
			await perform(deps.session, body);
		} catch (error) {
			if (
				error instanceof ActionNotFoundError &&
				(body.id || body.label) &&
				decision.x != null &&
				decision.y != null
			) {
				await perform(deps.session, {
					kind: body.kind === "input" ? "input" : "tap",
					x: decision.x,
					y: decision.y,
					text: body.text,
					double: body.double,
					durationMs: body.durationMs,
				});
			} else {
				throw error;
			}
		}
		await clock.sleep(settleMs);
		return "continue";
	};

	try {
		const instructionQueue = flattenCaseInstructions(
			deps.catalogCase.flows.length > 0
				? deps.catalogCase.flows
				: [{ id: "empty", instructions: "", expectedResult: "", flowId: null }],
		);

		const recentActions: AgentDecision[] = [];
		const completedInstructions: string[] = [];
		let prevFingerprint: string | null = null;

		for (let instructionIndex = 0; instructionIndex < instructionQueue.length; instructionIndex++) {
			const instruction = instructionQueue[instructionIndex];
			if (!instruction) break;
			if (deps.isAborted()) {
				caseStatus = "cancelled";
				break;
			}

			let instructionDone = false;
			for (let attempt = 0; attempt < maxSteps && !instructionDone; attempt++) {
				if (deps.isAborted()) {
					caseStatus = "cancelled";
					instructionDone = true;
					break;
				}

				const shotStarted = clock.now();
				const shot = await deps.session.screenshot();
				lastScreenshotUri = shot.path;
				const tree = await readCleanedTree(readScreen, deps.session);
				const fingerprint = screenshotFingerprint(shot.base64);
				const lastAction = recentActions.at(-1);
				const lastSwipeMovedScreen =
					lastAction?.type === "swipe" &&
					prevFingerprint != null &&
					fingerprint !== prevFingerprint;

				if (deps.isAborted()) {
					caseStatus = "cancelled";
					instructionDone = true;
					break;
				}

				const decideInput = {
					flow: instruction,
					imageBase64: shot.base64,
					recentActions,
					screenSnapshot: tree.snapshot,
					lastSwipeMovedScreen,
					completedInstructions,
					instructionOrdinal: instructionIndex + 1,
					instructionCount: instructionQueue.length,
				};

				let decision = await decideOnce(decideInput);
				prevFingerprint = fingerprint;

				const latencyMs = clock.now() - shotStarted;

				if (deps.isAborted()) {
					caseStatus = "cancelled";
					instructionDone = true;
					break;
				}

				let outcome: "continue" | "done" | "fail" = "continue";
				const applyWithRetry = async () => {
					try {
						outcome = await applyDecision(decision);
					} catch (error) {
						if (!isRetriableActionError(error) || deps.isAborted()) throw error;
						const failed = decision;
						decision = await decideOnce({
							...decideInput,
							recentActions: [...recentActions, failed],
							lastError: error instanceof Error ? error.message : String(error),
						});
						const retryCommand = commandForDecision(decision, deps.defaultAppId);
						await setCurrentCommand(retryCommand);
						outcome = await applyDecision(decision);
					}
				};

				const recordStep = async (command: string | null) => {
					recentActions.push(decision);
					recordedDecisions.push(decision);
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: outcome !== "fail",
						latencyMs,
						detail:
							decision.type === "wait"
								? (decision.reason ??
									`wait ${Math.min(3000, Math.max(500, decision.ms ?? 1500))}ms`)
								: (decision.reason ?? (outcome === "fail" ? "Agent failed the step" : null)),
						command,
					});
				};

				const initialCommand = commandForDecision(decision, deps.defaultAppId);
				if (initialCommand) {
					await withCurrentCommand(setCurrentCommand, initialCommand, async () => {
						await applyWithRetry();
						await recordStep(commandForDecision(decision, deps.defaultAppId));
					});
				} else {
					await applyWithRetry();
					await recordStep(null);
				}

				if (outcome === "done") {
					instructionDone = true;
					completedInstructions.push(instruction.instructions);
				} else if (outcome === "fail") {
					caseStatus = "errored";
					caseError = decision.reason ?? "Agent marked the instruction as failed";
					instructionDone = true;
				}

				stepIdx += 1;
			}

			if (caseStatus === "errored" || caseStatus === "cancelled") break;
			if (!instructionDone) {
				caseStatus = "errored";
				caseError = `Exceeded max steps (${maxSteps}) for instruction ${instructionIndex + 1} of ${instructionQueue.length}`;
				break;
			}
		}
	} catch (error) {
		if (deps.isAborted()) {
			caseStatus = "cancelled";
		} else {
			caseStatus = "errored";
			caseError = error instanceof Error ? error.message : String(error);
			await deps.appendStep({
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
				command: null,
			});
		}
	}

	if (deps.isAborted() || caseStatus === "cancelled") {
		return { status: "cancelled", decisions: recordedDecisions, error: null };
	}

	return { status: caseStatus, decisions: recordedDecisions, error: caseError };
}
