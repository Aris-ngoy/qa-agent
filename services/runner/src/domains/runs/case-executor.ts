import {
	type ActionRequest,
	type ActionResponse,
	type CaseScript,
	type CatalogCase,
	type ScreenElement,
	screenHasText,
} from "@yoqa/runner-client";
import { performAction as defaultPerformAction, getScreen } from "../devices/interaction";
import type { DeviceSession } from "../devices/session";
import type { ActiveProviderAuth } from "../providers/application";
import {
	type AgentDecision,
	decideNextAction as defaultDecideNextAction,
	isAbsurdNoScreenshotFail,
} from "./agent";

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
}) => Promise<void>;

export type CaseDecideFn = (input: {
	auth: ActiveProviderAuth;
	appContext: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	imageBase64: string;
	recentActions?: AgentDecision[];
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
	decide?: CaseDecideFn;
	performAction?: PerformActionFn;
	clock?: CaseExecutorClock;
	settleMs?: number;
	maxStepsPerCase?: number;
};

const defaultClock: CaseExecutorClock = {
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

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
				});
			} else if (action.type === "type") {
				await perform(deps.session, { kind: "input", text: action.text });
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
				});
			} else if (action.type === "assert") {
				const timeoutMs = action.timeoutMs ?? 5_000;
				const assertion = action.assertion;
				const deadline = clock.now() + timeoutMs;
				for (;;) {
					if (deps.isAborted()) {
						return "cancelled";
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
				});
			} else if (action.type === "alert") {
				await perform(deps.session, {
					kind: "alert",
					alertAction: action.alertAction === "dismiss" ? "dismiss" : "accept",
				});
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
				});
			} else {
				const waitMs = Math.min(3000, Math.max(500, action.ms));
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
	const clock = deps.clock ?? defaultClock;
	const settleMs = deps.settleMs ?? POST_ACTION_SETTLE_MS;
	const maxSteps = deps.maxStepsPerCase ?? MAX_STEPS_PER_CASE;

	let stepIdx = 0;
	let caseStatus: "passed" | "errored" | "cancelled" = "passed";
	let caseError: string | null = null;
	let lastScreenshotUri: string | null = null;
	const recordedDecisions: AgentDecision[] = [];

	try {
		const flows =
			deps.catalogCase.flows.length > 0
				? deps.catalogCase.flows
				: [{ id: "empty", instructions: "", expectedResult: "", flowId: null }];

		for (const flow of flows) {
			if (deps.isAborted()) {
				caseStatus = "cancelled";
				break;
			}

			const recentActions: AgentDecision[] = [];
			let flowDone = false;
			for (let attempt = 0; attempt < maxSteps && !flowDone; attempt++) {
				if (deps.isAborted()) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				const shotStarted = clock.now();
				const shot = await deps.session.screenshot();
				lastScreenshotUri = shot.path;

				if (deps.isAborted()) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				let decision = await decide({
					auth: deps.auth,
					appContext: deps.appContext,
					caseTitle: deps.catalogCase.name,
					instructions: flow.instructions,
					expectedResult: flow.expectedResult,
					stepIndex: stepIdx,
					imageBase64: shot.base64,
					recentActions,
				});

				// Vision models occasionally claim the image is missing; retry once.
				if (isAbsurdNoScreenshotFail(decision)) {
					decision = await decide({
						auth: deps.auth,
						appContext: deps.appContext,
						caseTitle: deps.catalogCase.name,
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

				const latencyMs = clock.now() - shotStarted;

				if (deps.isAborted()) {
					caseStatus = "cancelled";
					flowDone = true;
					break;
				}

				recentActions.push(decision);
				recordedDecisions.push(decision);

				if (decision.type === "tap") {
					const tapBody: ActionRequest = { kind: "tap" };
					if (decision.label) tapBody.label = decision.label;
					if (decision.id) tapBody.id = decision.id;
					if (!tapBody.label && !tapBody.id) {
						tapBody.x = decision.x ?? 500;
						tapBody.y = decision.y ?? 500;
					}
					await perform(deps.session, tapBody);
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
				} else if (decision.type === "alert") {
					await perform(deps.session, {
						kind: "alert",
						alertAction: decision.alertAction === "dismiss" ? "dismiss" : "accept",
					});
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
				} else if (decision.type === "type") {
					await perform(deps.session, { kind: "input", text: decision.text ?? "" });
					await clock.sleep(settleMs);
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
				} else if (decision.type === "wait") {
					const waitMs = Math.min(3000, Math.max(500, decision.ms ?? 1500));
					await clock.sleep(waitMs);
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? `wait ${waitMs}ms`,
					});
				} else if (decision.type === "verify" || decision.type === "done") {
					await deps.appendStep({
						idx: stepIdx,
						action: decision,
						screenshotUri: shot.path,
						ok: true,
						latencyMs,
						detail: decision.reason ?? null,
					});
					flowDone = true;
				} else {
					await deps.appendStep({
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
				caseError = `Exceeded max steps (${maxSteps}) for a flow`;
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
			});
		}
	}

	if (deps.isAborted() || caseStatus === "cancelled") {
		return { status: "cancelled", decisions: recordedDecisions, error: null };
	}

	return { status: caseStatus, decisions: recordedDecisions, error: caseError };
}
