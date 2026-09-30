import type { ActionRequest, ScreenElement } from "@yoqa/runner-client";
import { z } from "zod";
import { parseVisionObject } from "../providers/agent-json";
import type { ActiveProviderAuth } from "../providers/application";
import { completeVision } from "../providers/vision";
import type { VisionImage } from "../providers/vision-model";
import { pointFromGridCell } from "./coord-grid";

export { AgentProviderError, assertVisionCapableProvider } from "../providers/vision";

const swipeDirectionSchema = z.union([
	z.literal("up"),
	z.literal("down"),
	z.literal("left"),
	z.literal("right"),
]);

const agentDecisionSchema = z
	.object({
		type: z.union([
			z.literal("tap"),
			z.literal("swipe"),
			z.literal("drag"),
			z.literal("type"),
			z.literal("input"),
			z.literal("wait"),
			z.literal("alert"),
			z.literal("activate-app"),
			z.literal("terminate-app"),
			z.literal("restart-app"),
			z.literal("background-app"),
			z.literal("open-url"),
			z.literal("assert"),
			z.literal("verify"),
			z.literal("done"),
			z.literal("fail"),
		]),
		x: z.number().optional(),
		y: z.number().optional(),
		x2: z.number().optional(),
		y2: z.number().optional(),
		/** Labeled grid column 0–9. The runner computes x from this, not from a guessed x. */
		col: z.number().optional(),
		/** Labeled grid row 0–9. The runner computes y from this, not from a guessed y. */
		row: z.number().optional(),
		/** Where inside the cell, 0–4. 2 is the middle. */
		qx: z.number().optional(),
		qy: z.number().optional(),
		/** End cell for a drag. */
		col2: z.number().optional(),
		row2: z.number().optional(),
		qx2: z.number().optional(),
		qy2: z.number().optional(),
		/** Finger movement on the screenshot (Inspector swipe). Prefer this over guessing four coords. */
		direction: swipeDirectionSchema.optional(),
		/** Swipe/drag/long-press hold; session defaults to 400ms. */
		durationMs: z.number().optional(),
		/** Double-tap when type is tap. */
		double: z.boolean().optional(),
		/** Accessibility / visible label — use for system buttons like Allow, not in-app taps. */
		label: z.string().min(1).optional(),
		/** Android resource-id / iOS accessibility name. */
		id: z.string().min(1).optional(),
		/** Natural-language grounding when id/label/coords are not enough. */
		description: z.string().min(1).optional(),
		text: z.string().optional(),
		/** For wait: milliseconds to pause before the next screenshot (clamped server-side). */
		ms: z.number().optional(),
		alertAction: z.union([z.literal("accept"), z.literal("dismiss")]).optional(),
		/** Bundle id / application id for activate/terminate/restart; the executor falls back to the catalog id. */
		appId: z.string().min(1).optional(),
		url: z.string().min(1).optional(),
		/** Background duration in seconds. */
		seconds: z.number().optional(),
		/** Omitted means visible at the executor, matching the saved-script/action default. */
		assertion: z.union([z.literal("visible"), z.literal("not-visible")]).optional(),
		timeoutMs: z.number().optional(),
		/** One-sentence summary of the chosen action (shown collapsed in the run UI). */
		reason: z.string().min(1),
		/** 2–4 sentences: what is visible and why this action follows (expandable in the run UI). */
		thoughts: z.string().min(1),
	})
	.superRefine((value, ctx) => {
		if (value.type === "swipe") {
			const hasCoords = value.x != null && value.y != null && value.x2 != null && value.y2 != null;
			if (!hasCoords && value.direction == null) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "swipe requires direction or x,y,x2,y2",
				});
			}
		}
		if (value.type === "drag") {
			if (value.x == null || value.y == null || value.x2 == null || value.y2 == null) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "drag requires x,y,x2,y2",
				});
			}
		}
		if ((value.type === "type" || value.type === "input") && !value.text?.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "type/input requires text" });
		}
		if (value.type === "open-url" && !value.url?.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "open-url requires url" });
		}
		if (value.type === "assert" && !value.text?.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "assert requires text" });
		}
	});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type SwipeDirection = z.infer<typeof swipeDirectionSchema>;

/** Finger start→end on the 0–1000 screenshot grid (same as Inspector command-bar swipes). */
export const FINGER_SWIPE_NORMS: Record<
	SwipeDirection,
	{ x: number; y: number; x2: number; y2: number }
> = {
	up: { x: 500, y: 800, x2: 500, y2: 200 },
	down: { x: 500, y: 200, x2: 500, y2: 800 },
	left: { x: 800, y: 500, x2: 200, y2: 500 },
	right: { x: 200, y: 500, x2: 800, y2: 500 },
};

/** Resolve a swipe to screenshot-grid coordinates. Explicit x,y,x2,y2 win over direction. */
export function resolveSwipeNorm(decision: {
	x?: number;
	y?: number;
	x2?: number;
	y2?: number;
	direction?: SwipeDirection;
}): { x: number; y: number; x2: number; y2: number } | null {
	if (decision.x != null && decision.y != null && decision.x2 != null && decision.y2 != null) {
		return { x: decision.x, y: decision.y, x2: decision.x2, y2: decision.y2 };
	}
	if (decision.direction) return FINGER_SWIPE_NORMS[decision.direction];
	return null;
}

const MAX_SCREEN_SNAPSHOT_ROWS = 80;

function padNorm(n: number): string {
	return String(Math.round(n)).padStart(4, " ");
}

/** A node that covers the screen is the game/canvas surface, not a control. */
export function isFullBleedElement(element: { width: number; height: number }): boolean {
	return element.width >= 900 && element.height >= 900;
}

const GAME_APP_RE =
	/\b(this is a game|is a game|game app|mobile game|video game|unity|unreal|gameplay)\b/i;

/**
 * True when app context or knowledge says this catalog app is a game.
 * A Run starts such a case in Grid mode instead of plain x,y.
 */
export function isGameApp(appContext: string, appKnowledge?: string): boolean {
	return GAME_APP_RE.test(`${appContext}\n${appKnowledge ?? ""}`);
}

/** Stored in place of the accessibility tree when a step is screenshot-only. */
export const NO_TREE_SNAPSHOT =
	"(screenshot only — no accessibility tree is attached. Name the centre of the control on the screenshot.)";

/**
 * A screen whose only content is a full-screen surface (Unity, WebView, GL).
 * Named controls such as a login button keep the accessibility tree.
 */
export function isGameSurface(elements: ScreenElement[]): boolean {
	if (elements.length === 0 || !elements.some((element) => isFullBleedElement(element))) {
		return false;
	}
	return !elements.some((element) => {
		if (isFullBleedElement(element)) return false;
		return element.label.trim().length > 0 || Boolean(element.id?.trim());
	});
}

/**
 * Games and canvases expose few named controls. Those screens get a labeled
 * grid: the model names the cell, and the tap point is computed from it.
 */
export function isCanvasScreen(elements: ScreenElement[]): boolean {
	const namedSmall = elements.filter((element) => {
		if (isFullBleedElement(element)) return false;
		const named = element.label.trim().length > 0 || Boolean(element.id?.trim());
		return named && element.width <= 800 && element.height <= 400;
	});
	return namedSmall.length < 3;
}

/**
 * A full-screen id would tap the middle of the game. Keep the model's screenshot
 * point instead.
 */
export function releaseCanvasPoint(
	decision: AgentDecision,
	elements: ScreenElement[],
): AgentDecision {
	if (decision.x == null || decision.y == null || !decision.id) return decision;
	if (decision.type !== "tap" && decision.type !== "type" && decision.type !== "input") {
		return decision;
	}
	const match = elements.find((element) => element.id === decision.id);
	if (!match || !isFullBleedElement(match)) return decision;
	const { id: _fullBleedId, ...point } = decision;
	return point;
}

/** Games tap from the screenshot. Drop tree id/label so the point is what runs. */
export function forceScreenshotTap(decision: AgentDecision): AgentDecision {
	if (decision.type !== "tap" && decision.type !== "type" && decision.type !== "input") {
		return decision;
	}
	if (isSystemPermissionLabel(decision.label)) return decision;
	const { id: _treeId, label: _treeLabel, ...point } = decision;
	return point;
}

/** Shown when a screenshot-only step comes back naming a control but no point. */
export const SCREENSHOT_POINT_RETRY =
	"Send x and y (0–1000) for the centre of the control on the attached screenshot. Do not send id or label.";

/**
 * True when a tap has no point to hit. Without the tree a label or id cannot be
 * resolved, and a tap with no point would land in the middle of the screen.
 * System permission labels, swipes, and description taps do not need a point.
 */
export function screenshotPointMissing(decision: AgentDecision): boolean {
	if (decision.type !== "tap") return false;
	if (isSystemPermissionLabel(decision.label)) return false;
	if (decision.description) return false;
	return decision.x == null || decision.y == null;
}

/** Shown when the agent keeps waiting and the screenshot never changes. */
export function stuckWaitHint(waits: number): string {
	return `The screen has not changed after ${waits} waits. Stop waiting and act on what is visible in the screenshot; a system sheet or dialog may be waiting for a tap.`;
}

/** A grid index the model named. Values outside 0–max are a guessed coordinate, not a cell. */
function namedGridIndex(value: number | undefined, max: number): number | null {
	if (value == null || !Number.isFinite(value)) return null;
	const rounded = Math.round(value);
	if (rounded < 0 || rounded > max) return null;
	return rounded;
}

/** Shown when a gridded step comes back with a guessed x,y and no cell. */
export const GRID_CELL_RETRY =
	"Send col and row (0–9) of the labeled cell that contains the centre of the control, and qx and qy (0–4) for where inside that cell it sits. Do not send x or y.";

/**
 * True when this action needs a point and the model did not name a grid cell.
 * Swipes keep their direction. System permission labels stay on the tree.
 */
export function gridPointMissing(decision: AgentDecision): boolean {
	if (
		decision.type !== "tap" &&
		decision.type !== "type" &&
		decision.type !== "input" &&
		decision.type !== "drag"
	) {
		return false;
	}
	if (isSystemPermissionLabel(decision.label)) return false;
	if (namedGridIndex(decision.col, 9) == null || namedGridIndex(decision.row, 9) == null) {
		return true;
	}
	if (decision.type === "drag") {
		return namedGridIndex(decision.col2, 9) == null || namedGridIndex(decision.row2, 9) == null;
	}
	return false;
}

/**
 * Replace a model's x,y with the point computed from the labeled cell.
 * A col/row outside 0–9 is left alone so a guessed coordinate is not clamped onto the edge.
 */
export function applyGridPoint(decision: AgentDecision): AgentDecision {
	if (
		decision.type !== "tap" &&
		decision.type !== "type" &&
		decision.type !== "input" &&
		decision.type !== "drag" &&
		decision.type !== "swipe"
	) {
		return decision;
	}
	const col = namedGridIndex(decision.col, 9);
	const row = namedGridIndex(decision.row, 9);
	if (col == null || row == null) return decision;
	const start = pointFromGridCell({ col, row, qx: decision.qx, qy: decision.qy });
	const next: AgentDecision = { ...decision, x: start.x, y: start.y };
	const col2 = namedGridIndex(decision.col2, 9);
	const row2 = namedGridIndex(decision.row2, 9);
	if (col2 != null && row2 != null) {
		const end = pointFromGridCell({ col: col2, row: row2, qx: decision.qx2, qy: decision.qy2 });
		next.x2 = end.x;
		next.y2 = end.y;
	}
	return next;
}

/** Compact cleaned-tree listing — same 0–1000 grid as `yoqa screen`. */
export function formatScreenSnapshot(elements: ScreenElement[] | undefined): string {
	if (elements == null) return "(screen tree unavailable)";
	if (elements.length === 0) return "(empty tree)";
	const usable = elements.filter((element) => !isFullBleedElement(element));
	if (usable.length === 0) {
		return "(empty tree — full-screen canvas or game surface only. Ignore it. Use screenshot x,y for the centre of the control.)";
	}
	const ordered = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
	const shown = ordered.slice(0, MAX_SCREEN_SNAPSHOT_ROWS);
	const lines = shown.map((element) => {
		const id = element.id?.trim() ? ` id=${element.id.trim()}` : "";
		const label = element.label?.trim() || "(no label)";
		return `${padNorm(element.x)},${padNorm(element.y)}  ${Math.round(element.width)}x${Math.round(element.height)}${id}  ${label}`;
	});
	if (ordered.length > shown.length) {
		lines.push(`… ${ordered.length - shown.length} more elements omitted`);
	}
	return lines.join("\n");
}

/**
 * Map a vision decision onto the same ActionRequest the CLI posts.
 * Returns null for wait / assert / verify / done / fail (executor handles those).
 */
export function decisionToActionRequest(
	decision: AgentDecision,
	options: { defaultAppId?: string } = {},
): ActionRequest | null {
	const appId = decision.appId?.trim() || options.defaultAppId?.trim() || undefined;
	switch (decision.type) {
		case "tap": {
			const body: ActionRequest = { kind: "tap" };
			if (decision.double) body.double = true;
			if (decision.durationMs != null) body.durationMs = decision.durationMs;
			if (decision.description) body.description = decision.description;
			if (prefersScreenshotTap(decision)) {
				body.x = decision.x;
				body.y = decision.y;
			} else if (decision.id) {
				body.id = decision.id;
				if (decision.label) body.label = decision.label;
			} else if (decision.label) {
				body.label = decision.label;
			} else if (decision.description) {
				// description-only tap
			} else {
				body.x = decision.x ?? 500;
				body.y = decision.y ?? 500;
			}
			return body;
		}
		case "swipe": {
			const swipe = resolveSwipeNorm(decision);
			if (!swipe) return null;
			return {
				kind: "swipe",
				x: swipe.x,
				y: swipe.y,
				x2: swipe.x2,
				y2: swipe.y2,
				...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
			};
		}
		case "drag":
			if (decision.x == null || decision.y == null || decision.x2 == null || decision.y2 == null) {
				return null;
			}
			return {
				kind: "drag",
				x: decision.x,
				y: decision.y,
				x2: decision.x2,
				y2: decision.y2,
				...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
			};
		case "type":
		case "input": {
			const body: ActionRequest = { kind: "input", text: decision.text ?? "" };
			if (decision.id) body.id = decision.id;
			if (decision.label) body.label = decision.label;
			if (decision.x != null) body.x = decision.x;
			if (decision.y != null) body.y = decision.y;
			if (decision.description) body.description = decision.description;
			return body;
		}
		case "alert":
			return {
				kind: "alert",
				alertAction: decision.alertAction === "dismiss" ? "dismiss" : "accept",
			};
		case "activate-app":
			return appId ? { kind: "activate-app", appId } : null;
		case "terminate-app":
			return appId ? { kind: "terminate-app", appId } : null;
		case "restart-app":
			return appId ? { kind: "restart-app", appId } : null;
		case "background-app":
			return {
				kind: "background-app",
				...(decision.seconds != null ? { seconds: decision.seconds } : {}),
			};
		case "open-url":
			return decision.url ? { kind: "open-url", url: decision.url } : null;
		default:
			return null;
	}
}

const SCROLL_INTENT_RE = /\b(scroll|swipe|flick)\b/i;
const SCROLL_UP_RE = /\b(scroll\s+up|back\s+up|to the top|content above)\b/i;
const SCROLL_UNTIL_END_RE =
	/\b(scroll[\s\w]{0,48}(bottom|end)|cannot scroll|can not scroll|can't scroll|until you can'?t scroll|no longer scroll|not be able to scroll)\b/i;

/** True when reason/thoughts describe scrolling rather than a tap. */
export function looksLikeScrollIntent(text: string): boolean {
	return SCROLL_INTENT_RE.test(text);
}

/** True when the case asks to scroll until the list/page cannot move further. */
export function isScrollUntilEndGoal(instructions: string, expectedResult: string): boolean {
	return SCROLL_UNTIL_END_RE.test(`${instructions} ${expectedResult}`);
}

function inferFingerDirection(text: string): SwipeDirection {
	if (SCROLL_UP_RE.test(text)) return "down";
	if (/\bscroll\s+left\b/i.test(text) || /\bswipe\s+left\b/i.test(text)) return "left";
	if (/\bscroll\s+right\b/i.test(text) || /\bswipe\s+right\b/i.test(text)) return "right";
	return "up";
}

function asDirectionalSwipe(decision: AgentDecision): AgentDecision {
	const text = `${decision.reason} ${decision.thoughts}`;
	return {
		type: "swipe",
		direction: inferFingerDirection(text),
		reason: decision.reason,
		thoughts: decision.thoughts,
	};
}

/**
 * Models often emit tap/wait while describing a scroll. Rewrite those to a finger
 * swipe so the Device Session actually moves the list.
 */
export function coerceScrollIntentToSwipe(decision: AgentDecision): AgentDecision {
	if (decision.type === "tap" && isSystemPermissionLabel(decision.label)) return decision;
	if (decision.type !== "tap" && decision.type !== "wait") return decision;
	if (!looksLikeScrollIntent(`${decision.reason} ${decision.thoughts}`)) return decision;
	return asDirectionalSwipe(decision);
}

/**
 * Block verify/done on "scroll until the bottom" until a swipe ran and the
 * following screenshot stopped changing. Taps that do not move the list must
 * not count as reaching the end.
 */
export function continueScrollingInsteadOfComplete(input: {
	decision: AgentDecision;
	instructions: string;
	expectedResult: string;
	recentActions: AgentDecision[];
	lastSwipeMovedScreen: boolean;
}): AgentDecision {
	if (input.decision.type !== "verify" && input.decision.type !== "done") {
		return input.decision;
	}
	const hadSwipe = input.recentActions.some((action) => action.type === "swipe");
	const untilEnd = isScrollUntilEndGoal(input.instructions, input.expectedResult);
	const claimedScroll = looksLikeScrollIntent(
		`${input.decision.reason} ${input.decision.thoughts}`,
	);
	if (!hadSwipe && (untilEnd || claimedScroll)) {
		return asDirectionalSwipe(input.decision);
	}
	if (untilEnd && hadSwipe && input.lastSwipeMovedScreen) {
		return asDirectionalSwipe(input.decision);
	}
	return input.decision;
}

export function screenshotFingerprint(base64: string): string {
	return String(Bun.hash(base64));
}

const SYSTEM_PERMISSION_LABELS = new Set([
	"allow",
	"don't allow",
	"don’t allow",
	"deny",
	"while using the app",
	"while using this app",
	"allow all the time",
	"allow only while using the app",
	"only this time",
	"no thanks",
]);

/** True for system permission / notification sheet buttons — keep label taps, not screenshot coords. */
export function isSystemPermissionLabel(label: string | undefined): boolean {
	const trimmed = label?.trim().toLowerCase() ?? "";
	if (!trimmed) return false;
	return SYSTEM_PERMISSION_LABELS.has(trimmed);
}

/** In-app taps should use screenshot x,y even when the model also guessed a label. Tree `id` wins. */
export function prefersScreenshotTap(decision: {
	x?: number;
	y?: number;
	label?: string;
	id?: string;
}): decision is { x: number; y: number; label?: string; id?: string } {
	if (isSystemPermissionLabel(decision.label)) return false;
	if (decision.id?.trim()) return false;
	return decision.x != null && decision.y != null;
}

export function parseAgentDecision(raw: unknown): AgentDecision {
	return parseVisionObject(agentDecisionSchema, raw, "Model");
}

const REPLY_FORMAT = `Your entire reply MUST be a single strict JSON object (double quotes only — never single quotes) and nothing else — no markdown fences, no commentary before or after.
Every action MUST include:
- "reason": one short sentence summarizing the action choice
- "thoughts": 2–4 sentences describing what you see on screen and how that led to this action`;

const APP_LIFECYCLE_SHAPES = `{"type":"activate-app","appId":"com.example.app","reason":"...","thoughts":"..."}
{"type":"terminate-app","appId":"com.example.app","reason":"...","thoughts":"..."}
{"type":"restart-app","appId":"com.example.app","reason":"...","thoughts":"..."}
{"type":"background-app","seconds":3,"reason":"...","thoughts":"..."}
{"type":"open-url","url":"https://example.com","reason":"...","thoughts":"..."}
{"type":"assert","assertion":"visible|not-visible","text":"...","reason":"...","thoughts":"..."}
{"type":"wait","ms":500-3000,"reason":"...","thoughts":"..."}
{"type":"verify","reason":"...","thoughts":"..."}
{"type":"done","reason":"...","thoughts":"..."}
{"type":"fail","reason":"...","thoughts":"..."}`;

const KEYBOARD_GUIDANCE = `Textfield input and keyboard handling:
- Typing into a textfield brings up the virtual soft keyboard on the bottom of the screen (typically covering y ~ 550–1000), which may obscure buttons (like Submit, Login, Next) or lower inputs.
- When typing inside a textfield or when the keyboard is open:
  1. Dismiss keyboard by tapping away: Emit a tap on an empty, neutral background area outside textfields and above the keyboard (e.g. tap neutral header space or empty background) to dismiss the keyboard.
  2. Nextline / Return on keyboard: Tap the Return / Done / Next / Search key on the virtual keyboard itself (using its x,y coordinates), or append "\\n" to your input text.
  3. Dismiss then use app buttons: If an app button you need is obscured or covered by the soft keyboard, dismiss the keyboard first (by tapping away or pressing Return) so the button is revealed, then tap the app button on the subsequent step.`;

const SWIPE_GUIDANCE = `Swipe direction is the FINGER movement (same as Inspector):
- "down" (finger down, y 200→800): scroll UP — reveal content above
- "up" (finger up, y 800→200): scroll DOWN — reveal content below / to the bottom
- "left" / "right": horizontal paging
When the case says "scroll up", emit direction "down". When it says "scroll down" or "to the bottom", emit direction "up". Never tap to scroll. Never emit wait as a stand-in for scrolling.`;

/** Rules that hold in every Screen mode. */
const SHARED_RULES = `- activate-app / terminate-app / restart-app / open-url / background-app match yoqa action. Omit appId to use the catalog app id provided in the user message.
- To scroll a list or page, emit swipe — never a tap in the middle of the screen as a stand-in for scrolling.
- "Scroll until you cannot scroll anymore" / "to the bottom": keep emitting swipe (direction "up") until a later screenshot shows the same content. Then verify. Unchanged screens after taps do not count — taps do not scroll.
- You are given ONE current instruction. Complete only that instruction, then return verify or done. Later instructions are hidden on purpose — do not invent, skip ahead, or combine them. Earlier finished instructions may be omitted — do not reconstruct them.
- Do not open unrelated tabs or screens (Wallet, Profile, …) unless the current instruction says to. If the current target is not visible, scroll THIS screen to find it. If it cannot be found, fail with what you see.
- When THIS instruction's expected result is already visible, return verify or done. That finishes this instruction only, not the whole case. Otherwise return the next action. A separate verify check looks at the same screenshot after you decide.
- Splash / loading / blank screens: return wait (do not tap imaginary tabs).
- Do not repeat the same tap target from Recent actions unless the screenshot still shows you are on the wrong screen.
- On fail, say what you see (e.g. "splash logo only, no bottom tabs") — never "no screenshot".`;

/** Tree prompt: screenshot plus the Screen. Used in tree Screen mode. */
export const SYSTEM_PROMPT = `You are a mobile QA agent controlling an app using BOTH visual screenshots and screen snapshots (accessibility tree).
A screenshot of the current device screen is ALWAYS attached to the user message as an image. You can see it. Never claim that no screenshot was provided, missing, blank, or unavailable.

${REPLY_FORMAT}

Valid shapes:
{"type":"tap","label":"Allow","reason":"...","thoughts":"..."}
{"type":"tap","id":"permission_allow_button","reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"tap","description":"the blue Login button","reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"double":true,"reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"durationMs":2000,"reason":"...","thoughts":"..."}
{"type":"swipe","direction":"up|down|left|right","reason":"...","thoughts":"..."}
{"type":"swipe","x":0-1000,"y":0-1000,"x2":0-1000,"y2":0-1000,"reason":"...","thoughts":"..."}
{"type":"drag","x":0-1000,"y":0-1000,"x2":0-1000,"y2":0-1000,"reason":"...","thoughts":"..."}
{"type":"type","text":"...","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"input","text":"...","id":"email_field","reason":"...","thoughts":"..."}
{"type":"alert","alertAction":"accept","reason":"...","thoughts":"..."}
${APP_LIFECYCLE_SHAPES}

Coordinates use a 0–1000 normalized grid (0,0 top-left of the attached screenshot). The user message also includes a screen snapshot (cleaned accessibility tree) with the same grid — x,y is each element's TOP-LEFT, not centre. Centre = x + width/2, y + height/2.

Use BOTH the screenshot and the screen snapshot:
- Visual context (screenshot): Observe visual layout, colors, icons, canvas controls, modal overlays, and soft keyboard visibility.
- Structural context (screen snapshot): Inspect accessibility ids ("id=..."), element boundaries, and text labels.
- Decide whether to target by "id" or "x,y":
  * Use "id" when the snapshot provides a clean, unique, and unambiguous identifier for the element.
  * Use "x,y" coordinates (centre of the control on the screenshot grid) when controls lack IDs, are custom-drawn icons/canvas, or when coordinates are more direct and reliable than broad container IDs.
- System permission / notification dialogs: {"type":"tap","label":"Allow"} or {"type":"alert","alertAction":"accept"}. Never guess coordinates for these.
- If a previous action failed (see Last action error), pick a different target from the snapshot + screenshot — do not repeat the same id/label/point.

${KEYBOARD_GUIDANCE}

${SWIPE_GUIDANCE}

Rules:
- Look at the attached screenshot AND the screen snapshot before deciding.
- Double-tap: {"type":"tap","double":true,...}. Long-press: {"type":"tap","durationMs":2000,...}. Drag a slider/chip with type drag, not swipe.
- Assert text on the tree with {"type":"assert","assertion":"visible","text":"…"}.
${SHARED_RULES}`;

/**
 * Screenshot-only prompt: the default Screen mode. No accessibility tree is
 * attached, so the model names points by x,y (or a grid cell in Grid mode).
 */
export const VISION_SYSTEM_PROMPT = `You are a mobile QA agent controlling an app by looking at screenshots.
A screenshot of the current device screen is ALWAYS attached to the user message as an image. You can see it. Never claim that no screenshot was provided, missing, blank, or unavailable. No accessibility tree is provided — decide from the screenshot alone.

${REPLY_FORMAT}

Valid shapes:
{"type":"tap","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"double":true,"reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"durationMs":2000,"reason":"...","thoughts":"..."}
{"type":"tap","label":"Allow","reason":"...","thoughts":"..."}
{"type":"swipe","direction":"up|down|left|right","reason":"...","thoughts":"..."}
{"type":"swipe","x":0-1000,"y":0-1000,"x2":0-1000,"y2":0-1000,"reason":"...","thoughts":"..."}
{"type":"drag","x":0-1000,"y":0-1000,"x2":0-1000,"y2":0-1000,"reason":"...","thoughts":"..."}
{"type":"type","text":"...","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"alert","alertAction":"accept","reason":"...","thoughts":"..."}
${APP_LIFECYCLE_SHAPES}

Coordinates use a 0–1000 normalized grid over the attached screenshot (0,0 is the top-left corner, 1000,1000 the bottom-right). Send x,y for the CENTRE of the control you want to hit. Read it off the screenshot: a control's centre is halfway between its left and right edges, and halfway between its top and bottom edges.

Targeting:
- Tap with "x,y" on the screenshot. Do not send id — no ids are available. Do not send description.
- System permission / notification dialogs: {"type":"tap","label":"Allow"} or {"type":"alert","alertAction":"accept"}. Never guess coordinates for these.
- Visual context is all you have: read layout, colors, icons, canvas controls, modal overlays, and soft keyboard visibility from the screenshot.
- If a previous action failed (see Last action error), pick a different point on the screenshot — do not repeat the same point.
- If a magenta grid is drawn on the screenshot, each cell is labeled column-row in its top-left (0-0 through 9-9). Then send col, row, qx, and qy for the centre of the control, and do not send x or y. qx and qy are 0–4 (2 is the middle of the cell). The tap point is computed from that cell.

${KEYBOARD_GUIDANCE}

${SWIPE_GUIDANCE}

Rules:
- Look at the attached screenshot before deciding.
- Double-tap: {"type":"tap","double":true,...}. Long-press: {"type":"tap","durationMs":2000,...}. Drag a slider/chip with type drag, not swipe.
- To check that text is on screen, emit {"type":"assert","assertion":"visible","text":"…"} with the exact visible text.
${SHARED_RULES}`;

function formatRecentActions(actions: AgentDecision[]): string {
	if (actions.length === 0) return "(none — first step)";
	return actions
		.slice(-6)
		.map((action, i) => {
			const n = actions.length - Math.min(actions.length, 6) + i + 1;
			if (action.type === "tap") {
				if (action.label) {
					return `${n}. tap label "${action.label}" — ${action.reason ?? ""}`;
				}
				if (action.id) {
					return `${n}. tap id "${action.id}" — ${action.reason ?? ""}`;
				}
				return `${n}. tap (${action.x ?? "?"},${action.y ?? "?"}) — ${action.reason ?? ""}`;
			}
			if (action.type === "swipe") {
				if (action.direction) {
					return `${n}. swipe ${action.direction} — ${action.reason ?? ""}`;
				}
				return `${n}. swipe (${action.x ?? "?"},${action.y ?? "?"})→(${action.x2 ?? "?"},${action.y2 ?? "?"}) — ${action.reason ?? ""}`;
			}
			if (action.type === "alert") {
				return `${n}. alert ${action.alertAction ?? "accept"} — ${action.reason ?? ""}`;
			}
			if (action.type === "type" || action.type === "input") {
				return `${n}. type "${action.text ?? ""}" — ${action.reason ?? ""}`;
			}
			if (action.type === "drag") {
				return `${n}. drag (${action.x ?? "?"},${action.y ?? "?"})→(${action.x2 ?? "?"},${action.y2 ?? "?"}) — ${action.reason ?? ""}`;
			}
			if (action.type === "assert") {
				return `${n}. assert ${action.assertion ?? "visible"} "${action.text ?? ""}" — ${action.reason ?? ""}`;
			}
			if (
				action.type === "activate-app" ||
				action.type === "terminate-app" ||
				action.type === "restart-app"
			) {
				return `${n}. ${action.type} ${action.appId ?? ""} — ${action.reason ?? ""}`;
			}
			if (action.type === "open-url") {
				return `${n}. open-url ${action.url ?? ""} — ${action.reason ?? ""}`;
			}
			if (action.type === "wait") {
				return `${n}. wait ${action.ms ?? "?"}ms — ${action.reason ?? ""}`;
			}
			return `${n}. ${action.type} — ${action.reason ?? ""}`;
		})
		.join("\n");
}

const LIST_ITEM_START_RE = /^(?:\d+[.)]|\d+\s*[-–]|[-*•])\s+/;

/** A wrapped line continues the step above; a new instruction starts on its own line. */
function continuesInstruction(rawLine: string, line: string): boolean {
	if (/^\s/.test(rawLine)) return true;
	return /^[a-z]/.test(line);
}

/**
 * Split a flow's instructions into atomic steps. Numbered / bulleted lists and
 * one-instruction-per-line blocks become one item per line so the model never
 * sees the rest of a long case at once. A wrapped paragraph stays one step.
 */
export function splitInstructionSteps(instructions: string): string[] {
	const trimmed = instructions.replace(/\r\n/g, "\n").trim();
	if (!trimmed) return [""];

	const lines = trimmed.split("\n");
	const items: string[] = [];
	let current: string[] = [];
	let sawSteps = false;

	const pushCurrent = () => {
		const text = current.join(" ").replace(/\s+/g, " ").trim();
		if (text) items.push(text);
		current = [];
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			if (current.length > 0) {
				sawSteps = true;
				pushCurrent();
			}
			continue;
		}
		if (LIST_ITEM_START_RE.test(line)) {
			sawSteps = true;
			pushCurrent();
			current = [line.replace(LIST_ITEM_START_RE, "").trim()];
		} else if (current.length > 0 && !continuesInstruction(rawLine, line)) {
			sawSteps = true;
			pushCurrent();
			current = [line];
		} else if (current.length > 0) {
			current.push(line);
		} else {
			current = [line];
		}
	}
	pushCurrent();

	if (!sawSteps) return [trimmed];
	return items.length > 0 ? items : [trimmed];
}

export type AtomicCaseInstruction = {
	instructions: string;
	expectedResult: string;
};

/** Expand catalog flows into the queue the agent runs one instruction at a time. */
export function flattenCaseInstructions(
	flows: Array<{ instructions: string; expectedResult: string }>,
): AtomicCaseInstruction[] {
	const queue: AtomicCaseInstruction[] = [];
	for (const flow of flows) {
		const steps = splitInstructionSteps(flow.instructions);
		const usable = steps.length > 0 ? steps : [""];
		for (let i = 0; i < usable.length; i++) {
			const last = i === usable.length - 1;
			queue.push({
				instructions: usable[i] ?? "",
				expectedResult: last ? flow.expectedResult : "",
			});
		}
	}
	return queue.length > 0 ? queue : [{ instructions: "", expectedResult: "" }];
}

/** Finished instructions kept verbatim in the next decide prompt. */
const MAX_COMPLETED_IN_PROMPT = 3;

export function formatCompletedInstructions(completed: string[]): string {
	if (completed.length === 0) return "(none — this is the first instruction)";
	const omitted = Math.max(0, completed.length - MAX_COMPLETED_IN_PROMPT);
	const tail = completed.slice(-MAX_COMPLETED_IN_PROMPT);
	const lines = tail.map((text, index) => `${omitted + index + 1}. ${text}`);
	if (omitted === 0) return lines.join("\n");
	return `${omitted} earlier instructions already done (omitted — do not reconstruct or repeat them).\n${lines.join("\n")}`;
}

/** Prompt budget for the per-app knowledge document. */
const MAX_APP_KNOWLEDGE_CHARS = 2048;

/** App Knowledge: notes your team keeps about the app, injected into decide. */
function formatAppKnowledge(knowledge: string | undefined): string | null {
	const trimmed = (knowledge ?? "").trim();
	if (!trimmed) return null;
	if (trimmed.length <= MAX_APP_KNOWLEDGE_CHARS) return trimmed;
	return `${trimmed.slice(0, MAX_APP_KNOWLEDGE_CHARS)}\n… (app knowledge truncated at ${MAX_APP_KNOWLEDGE_CHARS} characters)`;
}

/** User-message body for a vision decide call (no image). */
export function formatDecidePrompt(input: {
	appContext: string;
	appKnowledge?: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	instructionOrdinal?: number;
	instructionCount?: number;
	completedInstructions?: string[];
	recentActions?: AgentDecision[];
	screenSnapshot?: string;
	lastError?: string;
	defaultAppId?: string;
	/** True when the attached screenshot has the 100-unit magenta grid. */
	coordGrid?: boolean;
	/** Screenshot only: the accessibility tree is not attached. Vision Screen mode, and Grid mode. */
	screenshotOnly?: boolean;
}): string {
	const ordinal = input.instructionOrdinal ?? input.stepIndex + 1;
	const total = input.instructionCount ?? 0;
	const remaining = total > 0 ? Math.max(0, total - ordinal) : 0;
	const expected = input.expectedResult.trim()
		? input.expectedResult
		: "(none for this instruction — return verify once you have performed it and the UI has updated)";
	const progress =
		total > 0
			? `Instruction ${ordinal} of ${total} — do ONLY this instruction${remaining > 0 ? `; ${remaining} remain after it` : " (last instruction)"}`
			: `Step ${input.stepIndex + 1}`;
	const later =
		remaining > 0
			? `Later instructions exist (${remaining}) but are hidden. Do not invent or perform them. Do not open unrelated screens to skip ahead.`
			: "This is the last instruction of the case.";

	const appKnowledge = formatAppKnowledge(input.appKnowledge);

	return [
		`App context: ${input.appContext || "(none)"}`,
		...(appKnowledge
			? [
					`App knowledge (notes your team keeps about this app — trust these over guesses):\n${appKnowledge}`,
				]
			: []),
		`Test case: ${input.caseTitle}`,
		progress,
		"Completed instructions (already done — do not repeat):",
		formatCompletedInstructions(input.completedInstructions ?? []),
		`Current instruction (do ONLY this): ${input.instructions || "(none)"}`,
		`Expected result for this instruction: ${expected}`,
		later,
		`Catalog app id (activate/terminate/restart): ${input.defaultAppId || "(unknown)"}`,
		`Recent actions:\n${formatRecentActions(input.recentActions ?? [])}`,
		`Last action error: ${input.lastError || "(none)"}`,
		...(input.screenshotOnly
			? [
					"No accessibility tree is attached. The attached screenshot was taken first and is all you have.",
					"Name the centre of the control on that screenshot as x,y (0–1000). Do not send id. Send label only for a system permission or notification button.",
				]
			: [
					"Screen snapshot (cleaned accessibility tree, 0–1000 grid, x,y is top-left):",
					input.screenSnapshot || "(unavailable)",
					"Look at the attached screenshot image AND the screen snapshot and decide the next action. Decide whether to use x,y coordinates or an id based on both sources. A screenshot is attached.",
				]),
		...(input.coordGrid
			? [
					"A magenta grid is drawn on the screenshot. Each cell is labeled in its top-left corner as column-row (0-0 is the top-left cell, 9-9 is the bottom-right). Do not send x or y. Send col and row (0–9) of the cell that contains the centre of the control, and qx and qy (0–4) for where inside that cell the centre sits: 0 is the left or top, 2 is the middle, 4 is the right or bottom. The tap point is computed from those values. For a drag, also send col2, row2, qx2, and qy2 for the end.",
				]
			: []),
		`Again, do ONLY this: ${input.instructions || "(none)"}`,
		'Reply with ONLY the JSON action object, including non-empty "reason" and "thoughts".',
	].join("\n");
}

/** Models sometimes hallucinate "no screenshot" even when an image was sent. */
export function isAbsurdNoScreenshotFail(decision: AgentDecision): boolean {
	if (decision.type !== "fail") return false;
	const text = `${decision.reason} ${decision.thoughts}`.toLowerCase();
	return (
		text.includes("no screenshot") ||
		text.includes("screenshot provided") ||
		text.includes("screenshot was not") ||
		text.includes("without a screenshot") ||
		text.includes("missing screenshot") ||
		text.includes("screenshot unavailable") ||
		text.includes("cannot see the screen") ||
		text.includes("no image")
	);
}

export type InstructionVerdict = {
	type: "verify" | "continue" | "fail";
	reason: string;
	thoughts: string;
};

const VERIFY_PROMPT = `You check whether ONE mobile test instruction is already satisfied.
A screenshot of the device AFTER the last action is attached. You can see it.
Reply with ONLY one JSON object: {"type":"verify"|"continue"|"fail","reason":"...","thoughts":"..."}
- verify: the current instruction's expected result is visible, or the instruction has clearly been performed.
- continue: the instruction is not finished. Do not invent the next tap.
- fail: the instruction cannot be completed from what is on screen.
Do not propose coordinates. Do not skip ahead to later instructions.`;

/** User message for the per-step verify check (no next-action request). */
export function formatVerifyPrompt(input: {
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	instructionOrdinal?: number;
	instructionCount?: number;
}): string {
	const ordinal = input.instructionOrdinal ?? 1;
	const total = input.instructionCount ?? 0;
	const progress = total > 0 ? `Instruction ${ordinal} of ${total}.` : "";
	const expected = input.expectedResult.trim()
		? input.expectedResult
		: "(none — verify once this instruction has been performed and the UI has updated)";
	return [
		`Test case: ${input.caseTitle}`,
		progress,
		`Instruction to verify: ${input.instructions || "(none)"}`,
		`Expected result: ${expected}`,
		"Look at the attached screenshot. Is this instruction satisfied now?",
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

/** Separate from decide: did the last action finish the current instruction? */
export async function verifyInstruction(input: {
	auth: ActiveProviderAuth;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	imageBase64: string;
	image?: VisionImage;
	instructionOrdinal?: number;
	instructionCount?: number;
	onDecideRetry?: () => void;
}): Promise<InstructionVerdict> {
	const verdictSchema = z.object({
		type: z.union([z.literal("verify"), z.literal("continue"), z.literal("fail")]),
		reason: z.string().min(1),
		thoughts: z.string().min(1),
	});
	const object = await completeVision(input.auth, {
		schema: verdictSchema,
		system: VERIFY_PROMPT,
		prompt: formatVerifyPrompt(input),
		imageBase64: input.imageBase64,
		image: input.image,
		onDecideRetry: input.onDecideRetry,
	});
	return object;
}

export async function decideNextAction(input: {
	auth: ActiveProviderAuth;
	appContext: string;
	appKnowledge?: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	imageBase64: string;
	image?: VisionImage;
	onDecideRetry?: () => void;
	recentActions?: AgentDecision[];
	screenSnapshot?: string;
	lastError?: string;
	defaultAppId?: string;
	completedInstructions?: string[];
	instructionOrdinal?: number;
	instructionCount?: number;
	coordGrid?: boolean;
	screenshotOnly?: boolean;
}): Promise<AgentDecision> {
	return completeVision(input.auth, {
		schema: agentDecisionSchema,
		system: input.screenshotOnly ? VISION_SYSTEM_PROMPT : SYSTEM_PROMPT,
		prompt: formatDecidePrompt(input),
		imageBase64: input.imageBase64,
		image: input.image,
		onDecideRetry: input.onDecideRetry,
	});
}
