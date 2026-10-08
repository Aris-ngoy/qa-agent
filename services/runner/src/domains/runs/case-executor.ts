import {
	type ActionRequest,
	type ActionResponse,
	type CallUsage,
	type CaseScript,
	type CatalogCase,
	type RunScreenMode,
	type ScreenElement,
	type StepPhases,
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
import { type VisionImage, prepareVisionImage } from "../providers/vision-model";
import {
	type AgentDecision,
	GRID_CELL_RETRY,
	type InstructionVerdict,
	NO_TREE_SNAPSHOT,
	SCREENSHOT_POINT_RETRY,
	applyGridPoint,
	coerceScrollIntentToSwipe,
	continueScrollingInsteadOfComplete,
	decisionToActionRequest,
	decideNextAction as defaultDecideNextAction,
	flattenCaseInstructions,
	forceScreenshotTap,
	formatScreenSnapshot,
	gridPointMissing,
	isAbsurdNoScreenshotFail,
	isCanvasScreen,
	isGameApp,
	isGameSurface,
	isSystemPermissionLabel,
	releaseCanvasPoint,
	repeatTapHint,
	screenshotFingerprint,
	screenshotPointMissing,
	snapTapToElement,
	stuckWaitHint,
	verifyInstruction,
} from "./agent";
import { overlayCoordGrid } from "./coord-grid";

/** Max vision/action iterations for the current instruction (not the whole case). */
export const MAX_STEPS_PER_CASE = 25;
/** Let splash / nav transitions settle before the next screenshot. */
export const POST_ACTION_SETTLE_MS = 800;
/** Consecutive x,y taps that leave the screenshot unchanged before a case escalates to Grid mode. */
/**
 * Unchanged x,y taps in a row before Grid mode is switched on for good. Grid is the last
 * resort: it comes after the tree assist below has had its two steps.
 */
export const GRID_ESCALATION_TAPS = 4;
/**
 * Unchanged actions in a row (waits aside) before the next decide also gets the screen tree,
 * on top of the screenshot. Vision mode only: tree mode always has it.
 */
export const TREE_ASSIST_ACTIONS = 2;
/** Consecutive waits on an unchanged screenshot before the agent is told to stop waiting. */
export const STUCK_WAITS = 3;
/** Unchanged taps near one spot before the model is told that spot is wrong. */
export const REPEAT_TAPS = 2;
/** Two taps this close on the 0–1000 grid count as the same spot. */
const REPEAT_TAP_RADIUS = 30;

export type AppendCaseStep = (input: {
	idx: number;
	action: unknown;
	screenshotUri: string | null;
	ok: boolean;
	latencyMs: number;
	/** Per-phase wall-clock breakdown (agent steps only). */
	phases?: StepPhases | null;
	detail: string | null;
	command: string | null;
}) => Promise<void>;

export type SetCurrentCommand = (command: string | null) => Promise<void>;

export type CaseDecideFn = (input: {
	auth: ActiveProviderAuth;
	appContext: string;
	appKnowledge?: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	imageBase64: string;
	/** Pre-prepared vision image for this step's screenshot (reused across retries). */
	image?: VisionImage;
	/**
	 * Called when this step's decide is retried: the Provider repaired invalid
	 * JSON, or the first reply was unusable (e.g. claiming no screenshot).
	 */
	onDecideRetry?: () => void;
	/** Called once per Decide or verify call with its Call usage (SDK Providers only). */
	onUsage?: (usage: CallUsage) => void;
	recentActions?: AgentDecision[];
	screenSnapshot?: string;
	lastError?: string;
	defaultAppId?: string;
	completedInstructions?: string[];
	instructionOrdinal?: number;
	instructionCount?: number;
	/** The attached screenshot includes the labeled magenta coordinate grid. */
	coordGrid?: boolean;
	/** The accessibility tree was omitted. Tap from the screenshot. */
	screenshotOnly?: boolean;
}) => Promise<AgentDecision>;

export type PerformActionFn = (
	session: DeviceSession,
	body: ActionRequest,
	options?: { screenElements?: ScreenElement[] },
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
	/** Per-app knowledge notes injected into the decide context (App Knowledge). */
	appKnowledge?: string;
	auth: ActiveProviderAuth;
	session: DeviceSession;
	isAborted: () => boolean;
	appendStep: AppendCaseStep;
	setCurrentCommand?: SetCurrentCommand;
	decide?: CaseDecideFn;
	/**
	 * What the agent sees. `vision` (default) sends only the screenshot and the
	 * instruction; `tree` also attaches the accessibility tree (Screen).
	 */
	screenMode?: RunScreenMode;
	/** When set, called after each decision. Production uses a vision verify when omitted. */
	verify?: (input: Parameters<CaseDecideFn>[0]) => Promise<InstructionVerdict>;
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

async function withCurrentCommand<T>(
	setCurrentCommand: SetCurrentCommand,
	command: string | null,
	work: () => Promise<T>,
): Promise<T> {
	await setCurrentCommand(command);
	try {
		return await work();
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

/** An x,y tap on the screenshot. Label taps on system sheets are not counted. */
function isPointTap(decision: AgentDecision): boolean {
	return (
		decision.type === "tap" &&
		decision.x != null &&
		decision.y != null &&
		!isSystemPermissionLabel(decision.label)
	);
}

function isDeviceDecision(decision: AgentDecision): boolean {
	return decision.type !== "verify" && decision.type !== "done" && decision.type !== "fail";
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

function sumTokens(total: number | null, more: number | null): number | null {
	if (total == null) return more;
	if (more == null) return total;
	return total + more;
}

/** Adds one call's Call usage to the step total. The first report creates `phases.usage`. */
function addCallUsage(phases: StepPhases, usage: CallUsage): void {
	const total = phases.usage;
	phases.usage = total
		? {
				inputTokens: sumTokens(total.inputTokens, usage.inputTokens),
				cachedInputTokens: sumTokens(total.cachedInputTokens, usage.cachedInputTokens),
				cacheWriteTokens: sumTokens(total.cacheWriteTokens, usage.cacheWriteTokens),
				outputTokens: sumTokens(total.outputTokens, usage.outputTokens),
			}
		: { ...usage };
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
	// Kept so a crashed step still reports the timing/retries it accumulated.
	let inFlightPhases: StepPhases | null = null;
	let inFlightLatencyMs = 0;

	const decideOnce = async (input: {
		flow: { instructions: string; expectedResult: string };
		imageBase64: string;
		image: VisionImage;
		recentActions: AgentDecision[];
		screenSnapshot: string;
		lastError?: string;
		lastSwipeMovedScreen: boolean;
		completedInstructions: string[];
		instructionOrdinal: number;
		instructionCount: number;
		screenElements: ScreenElement[];
		coordGrid: boolean;
		screenshotOnly: boolean;
		onDecideRetry?: () => void;
		onUsage?: (usage: CallUsage) => void;
	}): Promise<AgentDecision> => {
		const payload = {
			auth: deps.auth,
			appContext: deps.appContext,
			appKnowledge: deps.appKnowledge,
			caseTitle: deps.catalogCase.name,
			instructions: input.flow.instructions,
			expectedResult: input.flow.expectedResult,
			stepIndex: stepIdx,
			imageBase64: input.imageBase64,
			image: input.image,
			recentActions: input.recentActions,
			screenSnapshot: input.screenSnapshot,
			lastError: input.lastError,
			defaultAppId: deps.defaultAppId,
			completedInstructions: [...input.completedInstructions],
			instructionOrdinal: input.instructionOrdinal,
			instructionCount: input.instructionCount,
			coordGrid: input.coordGrid,
			screenshotOnly: input.screenshotOnly,
			onDecideRetry: input.onDecideRetry,
			onUsage: input.onUsage,
		};
		const finish = (raw: AgentDecision): AgentDecision => {
			let next = coerceScrollIntentToSwipe(raw);
			next = continueScrollingInsteadOfComplete({
				decision: next,
				instructions: input.flow.instructions,
				expectedResult: input.flow.expectedResult,
				recentActions: input.recentActions,
				lastSwipeMovedScreen: input.lastSwipeMovedScreen,
			});
			next = releaseCanvasPoint(next, input.screenElements);
			if (input.screenshotOnly) next = forceScreenshotTap(next);
			if (input.coordGrid) next = applyGridPoint(next);
			return next;
		};

		let decision = await decide(payload);
		if (isAbsurdNoScreenshotFail(decision)) {
			input.onDecideRetry?.();
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
		decision = finish(decision);
		if (input.coordGrid && gridPointMissing(decision)) {
			input.onDecideRetry?.();
			const retried = await decide({ ...payload, lastError: GRID_CELL_RETRY });
			if (!isAbsurdNoScreenshotFail(retried)) decision = finish(retried);
		} else if (input.screenshotOnly && !input.coordGrid && screenshotPointMissing(decision)) {
			input.onDecideRetry?.();
			const retried = await decide({ ...payload, lastError: SCREENSHOT_POINT_RETRY });
			if (!isAbsurdNoScreenshotFail(retried)) decision = finish(retried);
		}
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

	const applyDecision = async (
		decision: AgentDecision,
		phases: StepPhases,
		screenElements: ScreenElement[],
	): Promise<"continue" | "done" | "fail"> => {
		if (decision.type === "wait") {
			const waitMs = Math.min(3000, Math.max(500, decision.ms ?? 1500));
			const waitStarted = clock.now();
			await clock.sleep(waitMs);
			phases.actionMs += clock.now() - waitStarted;
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
			const assertStarted = clock.now();
			await runTextAssert({
				session: deps.session,
				readScreen,
				clock,
				isAborted: deps.isAborted,
				assertion,
				text: decision.text ?? "",
				timeoutMs,
			});
			phases.actionMs += clock.now() - assertStarted;
			return "continue";
		}
		const body = decisionToActionRequest(decision, { defaultAppId: deps.defaultAppId });
		if (!body) {
			throw new Error(`${decision.type} is missing required fields`);
		}
		const actionStarted = clock.now();
		try {
			// An empty list means the tree was not read this step (vision / Grid mode), not that the
			// screen has no elements. Passing it would make every label tap fail as "not found".
			await perform(deps.session, body, {
				screenElements: screenElements.length > 0 ? screenElements : undefined,
			});
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
		} finally {
			phases.actionMs += clock.now() - actionStarted;
		}
		const settleStarted = clock.now();
		await clock.sleep(settleMs);
		phases.settleMs += clock.now() - settleStarted;
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
		let lastVision: {
			imageBase64: string;
			image: VisionImage;
			screenSnapshot: string;
			coordGrid: boolean;
			screenshotOnly: boolean;
		} | null = null;
		const screenMode: RunScreenMode = deps.screenMode ?? "vision";
		// Grid mode: a labeled grid is drawn and the model names a cell. A game starts
		// there. Any other case is escalated into it, and never leaves it.
		const gameApp = isGameApp(deps.appContext, deps.appKnowledge);
		let gridMode = gameApp;
		let unchangedActions = 0;
		let unchangedPointTaps = 0;
		let unchangedWaits = 0;
		let repeatTaps = 0;
		let lastTapPoint: { x: number; y: number } | null = null;
		const omitsTree = () => screenMode === "vision" || gridMode;

		const verdictForDecision = async (
			decision: AgentDecision,
			input: Parameters<typeof decideOnce>[0],
		): Promise<InstructionVerdict> => {
			if (decision.type === "fail") {
				return { type: "fail", reason: decision.reason, thoughts: decision.thoughts };
			}
			if (decision.type === "verify" || decision.type === "done") {
				return { type: "verify", reason: decision.reason, thoughts: decision.thoughts };
			}
			if (deps.verify) {
				return deps.verify({
					auth: deps.auth,
					appContext: deps.appContext,
					appKnowledge: deps.appKnowledge,
					caseTitle: deps.catalogCase.name,
					instructions: input.flow.instructions,
					expectedResult: input.flow.expectedResult,
					stepIndex: stepIdx,
					imageBase64: input.imageBase64,
					image: input.image,
					recentActions: input.recentActions,
					screenSnapshot: input.screenSnapshot,
					lastError: input.lastError,
					defaultAppId: deps.defaultAppId,
					completedInstructions: [...input.completedInstructions],
					instructionOrdinal: input.instructionOrdinal,
					instructionCount: input.instructionCount,
					coordGrid: input.coordGrid,
					screenshotOnly: input.screenshotOnly,
					onDecideRetry: input.onDecideRetry,
					onUsage: input.onUsage,
				});
			}
			if (deps.decide) {
				return {
					type: "continue",
					reason: "Instruction still in progress",
					thoughts: decision.thoughts,
				};
			}
			return verifyInstruction({
				auth: deps.auth,
				caseTitle: deps.catalogCase.name,
				instructions: input.flow.instructions,
				expectedResult: input.flow.expectedResult,
				imageBase64: input.imageBase64,
				image: input.image,
				instructionOrdinal: input.instructionOrdinal,
				instructionCount: input.instructionCount,
				onDecideRetry: input.onDecideRetry,
				onUsage: input.onUsage,
			});
		};

		for (let instructionIndex = 0; instructionIndex < instructionQueue.length; instructionIndex++) {
			const instruction = instructionQueue[instructionIndex];
			if (!instruction) break;
			if (deps.isAborted()) {
				caseStatus = "cancelled";
				break;
			}

			let instructionDone = false;
			let pending: AgentDecision | null = null;
			let pendingElements: ScreenElement[] = [];
			for (let attempt = 0; attempt < maxSteps && !instructionDone; attempt++) {
				if (deps.isAborted()) {
					caseStatus = "cancelled";
					instructionDone = true;
					break;
				}

				const phases: StepPhases = {
					captureMs: 0,
					screenMs: 0,
					prepareMs: 0,
					decideMs: 0,
					actionMs: 0,
					settleMs: 0,
					decideRetries: 0,
				};
				const reportUsage = (usage: CallUsage) => addCallUsage(phases, usage);

				// Each step is action → screenshot → decision → verify.
				// The action is the previous decision; the first step only looks.
				let performed: AgentDecision | null = null;
				if (pending && isDeviceDecision(pending)) {
					const command = commandForDecision(pending, deps.defaultAppId);
					try {
						await withCurrentCommand(setCurrentCommand, command, async () => {
							await applyDecision(pending as AgentDecision, phases, pendingElements);
						});
						performed = pending;
					} catch (error) {
						if (!isRetriableActionError(error) || deps.isAborted()) throw error;
						const failed = pending;
						const retryStarted = clock.now();
						pending = await decideOnce({
							flow: instruction,
							imageBase64: lastVision?.imageBase64 ?? "",
							image: lastVision?.image ?? { base64: "", mediaType: "image/png" },
							recentActions: [...recentActions, failed],
							screenSnapshot: lastVision?.screenSnapshot ?? "",
							lastError: error instanceof Error ? error.message : String(error),
							lastSwipeMovedScreen: false,
							completedInstructions,
							instructionOrdinal: instructionIndex + 1,
							instructionCount: instructionQueue.length,
							screenElements: pendingElements,
							coordGrid: lastVision?.coordGrid ?? false,
							screenshotOnly: lastVision?.screenshotOnly ?? omitsTree(),
							onDecideRetry: () => {
								phases.decideRetries += 1;
							},
							onUsage: reportUsage,
						});
						phases.decideMs += clock.now() - retryStarted;
						if (!isDeviceDecision(pending)) {
							performed = null;
							const terminal = pending;
							pending = null;
							const outcome = terminal.type === "fail" ? "fail" : "done";
							recentActions.push(terminal);
							recordedDecisions.push(terminal);
							await deps.appendStep({
								idx: stepIdx,
								action: {
									...terminal,
									cycle: {
										action: failed,
										decision: terminal,
										verify: {
											type: outcome === "fail" ? "fail" : "verify",
											reason: terminal.reason,
											thoughts: terminal.thoughts,
										},
									},
								},
								screenshotUri: lastScreenshotUri,
								ok: outcome !== "fail",
								latencyMs: clock.now() - retryStarted,
								phases,
								detail: terminal.reason,
								command: commandForDecision(failed, deps.defaultAppId),
							});
							stepIdx += 1;
							if (outcome === "fail") {
								caseStatus = "errored";
								caseError = terminal.reason ?? "Agent marked the instruction as failed";
							} else {
								completedInstructions.push(instruction.instructions);
							}
							instructionDone = true;
							break;
						}
						const retryCommand = commandForDecision(pending, deps.defaultAppId);
						await withCurrentCommand(setCurrentCommand, retryCommand, async () => {
							await applyDecision(pending as AgentDecision, phases, pendingElements);
						});
						recentActions.push(pending);
						performed = pending;
					}
				}

				let phaseStartedAt = clock.now();
				const shotStarted = phaseStartedAt;
				inFlightPhases = phases;
				const shot = await deps.session.screenshot();
				lastScreenshotUri = shot.path;
				const advance = (phase: "captureMs" | "screenMs" | "prepareMs" | "decideMs") => {
					const now = clock.now();
					phases[phase] = now - phaseStartedAt;
					phaseStartedAt = now;
				};
				advance("captureMs");
				const fingerprint = screenshotFingerprint(shot.base64);
				// Escalation: taps that keep leaving the screenshot unchanged are landing
				// nowhere. Switch this case to Grid mode for good. Tree mode has ids instead.
				let escalatedToGrid = false;
				if (screenMode === "vision" && !gridMode && performed) {
					if (isPointTap(performed) && prevFingerprint != null && fingerprint === prevFingerprint) {
						unchangedPointTaps += 1;
					} else {
						unchangedPointTaps = 0;
					}
					if (unchangedPointTaps >= GRID_ESCALATION_TAPS) {
						gridMode = true;
						escalatedToGrid = true;
					}
				}
				// Any action that leaves the screenshot unchanged counts, whatever it was. A wait is
				// neither: it is expected not to change the screen, and has its own hint below.
				if (performed && performed.type !== "wait") {
					unchangedActions =
						prevFingerprint != null && fingerprint === prevFingerprint ? unchangedActions + 1 : 0;
				}
				// Second opinion: the tree can name a control the screenshot guess keeps missing. A known
				// game has no useful tree, so it keeps the grid instead.
				const treeAssist =
					screenMode === "vision" && !gameApp && unchangedActions >= TREE_ASSIST_ACTIONS;
				// Waiting on a screen that never changes is a stall, not progress. The model
				// must be told, because a sheet the tree cannot see may be waiting for a tap.
				if (performed?.type === "wait") {
					unchangedWaits =
						prevFingerprint != null && fingerprint === prevFingerprint ? unchangedWaits + 1 : 0;
				} else if (performed) {
					unchangedWaits = 0;
				}
				// Tapping the same spot over and over while nothing changes: that spot is wrong.
				if (performed && isPointTap(performed)) {
					const point = { x: performed.x as number, y: performed.y as number };
					const unchanged = prevFingerprint != null && fingerprint === prevFingerprint;
					const sameSpot =
						lastTapPoint != null &&
						Math.hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y) <= REPEAT_TAP_RADIUS;
					repeatTaps = unchanged ? (sameSpot ? repeatTaps + 1 : 1) : 0;
					lastTapPoint = point;
				} else if (performed) {
					repeatTaps = 0;
					lastTapPoint = null;
				}
				let tree =
					omitsTree() && !treeAssist
						? { snapshot: NO_TREE_SNAPSHOT, elements: [] as ScreenElement[] }
						: await readCleanedTree(readScreen, deps.session);
				advance("screenMs");
				const canvas = !omitsTree() && isCanvasScreen(tree.elements);
				if ((!omitsTree() || treeAssist) && isGameSurface(tree.elements)) {
					gridMode = true;
					tree = { snapshot: NO_TREE_SNAPSHOT, elements: [] };
				}
				// Vision step that borrowed the tree. An empty tree or a game surface gives nothing to add.
				const assisted = treeAssist && tree.elements.length > 0;
				const screenshotOnly = omitsTree() && !assisted;
				const gridded = (gridMode && !assisted) || canvas ? overlayCoordGrid(shot.base64) : null;
				const stallHint =
					unchangedWaits >= STUCK_WAITS
						? stuckWaitHint(unchangedWaits)
						: repeatTaps >= REPEAT_TAPS && lastTapPoint
							? repeatTapHint(
									lastTapPoint.x,
									lastTapPoint.y,
									repeatTaps,
									assisted ? "tree" : gridMode ? "grid" : "vision",
								)
							: undefined;
				const visionBase64 = gridded ?? shot.base64;
				const image = await prepareVisionImage(visionBase64);
				advance("prepareMs");
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
					imageBase64: visionBase64,
					image,
					recentActions,
					screenSnapshot: tree.snapshot,
					lastError: stallHint,
					lastSwipeMovedScreen,
					completedInstructions,
					instructionOrdinal: instructionIndex + 1,
					instructionCount: instructionQueue.length,
					screenElements: tree.elements,
					coordGrid: gridded != null,
					screenshotOnly,
					onDecideRetry: () => {
						phases.decideRetries += 1;
					},
					onUsage: reportUsage,
				};
				lastVision = {
					imageBase64: visionBase64,
					image,
					screenSnapshot: tree.snapshot,
					coordGrid: gridded != null,
					screenshotOnly,
				};

				let decision = await decideOnce(decideInput);
				prevFingerprint = fingerprint;
				// The model's point missed twice. The tree is already here: move the tap onto the nearest control.
				let snappedTo: ScreenElement | null = null;
				if (assisted) {
					const snapped = snapTapToElement(decision, tree.elements);
					decision = snapped.decision;
					snappedTo = snapped.element;
				}

				let verdict = await verdictForDecision(decision, decideInput);
				const guarded = continueScrollingInsteadOfComplete({
					decision: {
						type: "verify",
						reason: verdict.reason,
						thoughts: verdict.thoughts,
					},
					instructions: instruction.instructions,
					expectedResult: instruction.expectedResult,
					recentActions,
					lastSwipeMovedScreen,
				});
				if (verdict.type === "verify" && guarded.type !== "verify" && guarded.type !== "done") {
					verdict = {
						type: "continue",
						reason: guarded.reason,
						thoughts: guarded.thoughts,
					};
					if (!isDeviceDecision(decision)) decision = guarded;
				}
				advance("decideMs");

				const latencyMs = phaseStartedAt - shotStarted;
				inFlightLatencyMs = latencyMs;

				if (deps.isAborted()) {
					caseStatus = "cancelled";
					instructionDone = true;
					break;
				}

				const outcome =
					verdict.type === "fail" ? "fail" : verdict.type === "verify" ? "done" : "continue";
				const command = commandForDecision(performed ?? decision, deps.defaultAppId);
				recentActions.push(decision);
				recordedDecisions.push(decision);
				await deps.appendStep({
					idx: stepIdx,
					action: {
						...decision,
						...(escalatedToGrid ? { escalatedToGrid: true } : {}),
						...(assisted ? { treeAssist: true } : {}),
						...(snappedTo ? { snappedTo: snappedTo.id?.trim() || snappedTo.label } : {}),
						cycle: {
							action: performed,
							decision,
							verify: {
								type: verdict.type,
								reason: verdict.reason,
								thoughts: verdict.thoughts,
							},
						},
					},
					screenshotUri: shot.path,
					ok: outcome !== "fail",
					latencyMs,
					phases,
					detail:
						verdict.reason ||
						(decision.type === "wait"
							? (decision.reason ?? `wait ${Math.min(3000, Math.max(500, decision.ms ?? 1500))}ms`)
							: (decision.reason ?? (outcome === "fail" ? "Agent failed the step" : null))),
					command,
				});

				if (outcome === "done") {
					instructionDone = true;
					completedInstructions.push(instruction.instructions);
					pending = null;
				} else if (outcome === "fail") {
					caseStatus = "errored";
					caseError = verdict.reason || decision.reason || "Agent marked the instruction as failed";
					instructionDone = true;
					pending = null;
				} else {
					pending = isDeviceDecision(decision) ? decision : null;
					pendingElements = tree.elements;
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
				latencyMs: inFlightLatencyMs,
				phases: inFlightPhases,
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
