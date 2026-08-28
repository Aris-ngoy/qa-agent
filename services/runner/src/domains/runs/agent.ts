import { z } from "zod";
import { parseVisionObject } from "../providers/agent-json";
import type { ActiveProviderAuth } from "../providers/application";
import { completeVision } from "../providers/vision";

export { AgentProviderError, assertVisionCapableProvider } from "../providers/vision";

const agentDecisionSchema = z.object({
	type: z.union([
		z.literal("tap"),
		z.literal("type"),
		z.literal("wait"),
		z.literal("alert"),
		z.literal("verify"),
		z.literal("done"),
		z.literal("fail"),
	]),
	x: z.number().optional(),
	y: z.number().optional(),
	/** Accessibility / visible label — use for system buttons like Allow, not in-app taps. */
	label: z.string().min(1).optional(),
	/** Android resource-id / iOS accessibility name. */
	id: z.string().min(1).optional(),
	text: z.string().optional(),
	/** For wait: milliseconds to pause before the next screenshot (clamped server-side). */
	ms: z.number().optional(),
	alertAction: z.union([z.literal("accept"), z.literal("dismiss")]).optional(),
	/** One-sentence summary of the chosen action (shown collapsed in the run UI). */
	reason: z.string().min(1),
	/** 2–4 sentences: what is visible and why this action follows (expandable in the run UI). */
	thoughts: z.string().min(1),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

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

/** In-app taps should use screenshot x,y even when the model also guessed a label/id. */
export function prefersScreenshotTap(decision: {
	x?: number;
	y?: number;
	label?: string;
}): decision is { x: number; y: number; label?: string } {
	return decision.x != null && decision.y != null && !isSystemPermissionLabel(decision.label);
}

export function parseAgentDecision(raw: unknown): AgentDecision {
	return parseVisionObject(agentDecisionSchema, raw, "Model");
}

const SYSTEM_PROMPT = `You are a mobile QA agent controlling an app via screenshots.
A screenshot of the current device screen is ALWAYS attached to the user message as an image. You can see it. Never claim that no screenshot was provided, missing, blank, or unavailable.

Your entire reply MUST be a single strict JSON object (double quotes only — never single quotes) and nothing else — no markdown fences, no commentary before or after.
Every action MUST include:
- "reason": one short sentence summarizing the action choice
- "thoughts": 2–4 sentences describing what you see on screen and how that led to this action

Valid shapes:
{"type":"tap","label":"Allow","reason":"...","thoughts":"..."}
{"type":"tap","id":"permission_allow_button","reason":"...","thoughts":"..."}
{"type":"tap","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"alert","alertAction":"accept","reason":"...","thoughts":"..."}
{"type":"type","text":"...","reason":"...","thoughts":"..."}
{"type":"wait","ms":500-3000,"reason":"...","thoughts":"..."}
{"type":"verify","reason":"...","thoughts":"..."}
{"type":"done","reason":"...","thoughts":"..."}
{"type":"fail","reason":"...","thoughts":"..."}

Coordinates use a 0–1000 normalized grid (0,0 top-left of the attached screenshot). For in-app controls, tap using screenshot x,y from what you see — do not prefer label or id over those coordinates.

Rules:
- Look at the attached screenshot before deciding. Base taps on what is visible now.
- For ordinary app UI, emit {"type":"tap","x":…,"y":…} using the screenshot grid. Include label or id only for system permission / notification dialogs.
- System permission / notification dialogs (Allow, Don't allow, While using the app): use {"type":"tap","label":"Allow"} or {"type":"alert","alertAction":"accept"}. Never guess coordinates for these buttons — coordinate taps often miss.
- If the expected result (or the goal of the instructions) is already visible, return verify or done — do not keep tapping the same control.
- Splash / loading / blank screens: return wait (do not tap imaginary tabs).
- Do not repeat the same tap target from Recent actions unless the screenshot still shows you are on the wrong screen.
- On fail, say what you see (e.g. "splash logo only, no bottom tabs") — never "no screenshot".`;

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
			if (action.type === "alert") {
				return `${n}. alert ${action.alertAction ?? "accept"} — ${action.reason ?? ""}`;
			}
			if (action.type === "type") {
				return `${n}. type "${action.text ?? ""}" — ${action.reason ?? ""}`;
			}
			if (action.type === "wait") {
				return `${n}. wait ${action.ms ?? "?"}ms — ${action.reason ?? ""}`;
			}
			return `${n}. ${action.type} — ${action.reason ?? ""}`;
		})
		.join("\n");
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

export async function decideNextAction(input: {
	auth: ActiveProviderAuth;
	appContext: string;
	caseTitle: string;
	instructions: string;
	expectedResult: string;
	stepIndex: number;
	imageBase64: string;
	recentActions?: AgentDecision[];
}): Promise<AgentDecision> {
	const prompt = [
		`App context: ${input.appContext || "(none)"}`,
		`Test case: ${input.caseTitle}`,
		`Step ${input.stepIndex + 1}`,
		`Instructions: ${input.instructions || "(none)"}`,
		`Expected result: ${input.expectedResult || "(none)"}`,
		`Recent actions:\n${formatRecentActions(input.recentActions ?? [])}`,
		"Look at the attached screenshot image and decide the next action. A screenshot is attached.",
		'Reply with ONLY the JSON action object, including non-empty "reason" and "thoughts".',
	].join("\n");

	return completeVision(input.auth, {
		schema: agentDecisionSchema,
		system: SYSTEM_PROMPT,
		prompt,
		imageBase64: input.imageBase64,
	});
}
