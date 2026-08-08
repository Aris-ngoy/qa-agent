import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError, NoObjectGeneratedError, generateObject } from "ai";
import { z } from "zod";
import { decideWithAntigravityCli } from "../providers/antigravity-decide";
import type { ActiveProviderAuth } from "../providers/application";
import { decideWithCursorCli } from "../providers/cursor-decide";
import {
	AgentProviderError,
	OPENCODE_DEFAULT_VISION_MODEL,
	assertVisionCapableProvider,
	createVisionModel,
	formatProviderHttpError,
	resolveGoogleKey,
} from "../providers/vision-model";

export { AgentProviderError, assertVisionCapableProvider, OPENCODE_DEFAULT_VISION_MODEL };

/** DeepSeek-style reasoning models burn tokens before `content`; leave headroom. */
const VISION_MAX_TOKENS = 4096;
/** Longest edge for model inputs — full iPhone PNGs are huge and flaky upstream. */
const VISION_MAX_EDGE = 1170;

const agentDecisionSchema = z.object({
	type: z.union([
		z.literal("tap"),
		z.literal("type"),
		z.literal("wait"),
		z.literal("verify"),
		z.literal("done"),
		z.literal("fail"),
	]),
	x: z.number().min(0).max(1000).optional(),
	y: z.number().min(0).max(1000).optional(),
	text: z.string().optional(),
	/** For wait: milliseconds to pause before the next screenshot (clamped server-side). */
	ms: z.number().min(0).max(10_000).optional(),
	/** One-sentence summary of the chosen action (shown collapsed in the run UI). */
	reason: z.string().min(1),
	/** 2–4 sentences: what is visible and why this action follows (expandable in the run UI). */
	thoughts: z.string().min(1),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

const SYSTEM_PROMPT = `You are a mobile QA agent controlling an app via screenshots.
A screenshot of the current device screen is ALWAYS attached to the user message as an image. You can see it. Never claim that no screenshot was provided, missing, blank, or unavailable.

Your entire reply MUST be a single strict JSON object (double quotes only — never single quotes) and nothing else — no markdown fences, no commentary before or after.
Every action MUST include:
- "reason": one short sentence summarizing the action choice
- "thoughts": 2–4 sentences describing what you see on screen and how that led to this action

Valid shapes:
{"type":"tap","x":0-1000,"y":0-1000,"reason":"...","thoughts":"..."}
{"type":"type","text":"...","reason":"...","thoughts":"..."}
{"type":"wait","ms":500-3000,"reason":"...","thoughts":"..."}
{"type":"verify","reason":"...","thoughts":"..."}
{"type":"done","reason":"...","thoughts":"..."}
{"type":"fail","reason":"...","thoughts":"..."}

Coordinates use a 0–1000 normalized grid (0,0 top-left).

Rules:
- Look at the attached screenshot before deciding. Base taps on what is visible now.
- If the expected result (or the goal of the instructions) is already visible, return verify or done — do not keep tapping the same control.
- Splash / loading / blank screens: return wait (do not tap imaginary tabs).
- Do not repeat the same tap target from Recent actions unless the screenshot still shows you are on the wrong screen.
- On fail, say what you see (e.g. "splash logo only, no bottom tabs") — never "no screenshot".`;

const JSON_REPAIR_PROMPT =
	"Your previous reply was not valid JSON for this task. Reply again with ONLY one strict JSON object using double quotes for every key and string (no single quotes, no markdown, no prose) matching: " +
	'{"type":"tap"|"type"|"wait"|"verify"|"done"|"fail", "reason":"...", "thoughts":"...", ...}';
type VisionImage = { base64: string; mediaType: "image/png" | "image/jpeg" };

/**
 * Shrink device screenshots for vision APIs. Full-res iPhone PNGs (~1–2MB) are
 * flaky on OpenCode Zen; a ~1170px JPEG is enough for tap targeting.
 */
export async function prepareVisionImage(pngBase64: string): Promise<VisionImage> {
	const bytes = Buffer.from(pngBase64, "base64");
	if (bytes.byteLength === 0) {
		return { base64: pngBase64, mediaType: "image/png" };
	}
	if (process.platform !== "darwin") {
		return { base64: pngBase64, mediaType: "image/png" };
	}

	const dir = await mkdtemp(join(tmpdir(), "yoqa-vision-"));
	const inPath = join(dir, "shot.png");
	const outPath = join(dir, "shot.jpg");
	try {
		await writeFile(inPath, new Uint8Array(bytes));
		const proc = Bun.spawn(
			[
				"sips",
				"-Z",
				String(VISION_MAX_EDGE),
				"-s",
				"format",
				"jpeg",
				"-s",
				"formatOptions",
				"70",
				inPath,
				"--out",
				outPath,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		const code = await proc.exited;
		if (code !== 0) {
			return { base64: pngBase64, mediaType: "image/png" };
		}
		const jpeg = await readFile(outPath);
		if (jpeg.byteLength === 0 || jpeg.byteLength >= bytes.byteLength) {
			return { base64: pngBase64, mediaType: "image/png" };
		}
		return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
	} catch {
		return { base64: pngBase64, mediaType: "image/png" };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

function mapProviderError(label: string, error: unknown): never {
	if (error instanceof AgentProviderError) throw error;

	if (APICallError.isInstance(error)) {
		const body = error.responseBody ?? error.message;
		const status = error.statusCode ?? 0;
		throw new AgentProviderError(formatProviderHttpError(label, status, body));
	}

	if (NoObjectGeneratedError.isInstance(error)) {
		const text = error.text?.trim() ?? "";
		if (!text && error.finishReason === "length") {
			throw new AgentProviderError(
				"Model returned an empty response (expected JSON action) — output truncated while reasoning. Retry the run or pick a non-reasoning vision model in Settings → Provider.",
			);
		}
		const snippet = text.replace(/\s+/g, " ").slice(0, 160);
		if (!snippet) {
			throw new AgentProviderError("Model returned an empty response (expected JSON action)");
		}
		throw new AgentProviderError(
			`Model did not return JSON (got: ${snippet}${text.length > 160 ? "…" : ""})`,
		);
	}

	if (error instanceof Error) {
		throw new AgentProviderError(error.message);
	}
	throw new AgentProviderError(String(error));
}

function formatRecentActions(actions: AgentDecision[]): string {
	if (actions.length === 0) return "(none — first step)";
	return actions
		.slice(-6)
		.map((action, i) => {
			const n = actions.length - Math.min(actions.length, 6) + i + 1;
			if (action.type === "tap") {
				return `${n}. tap (${action.x ?? "?"},${action.y ?? "?"}) — ${action.reason ?? ""}`;
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

async function decideWithModel(
	auth: ActiveProviderAuth,
	prompt: string,
	imageBase64: string,
	repairHint?: string,
): Promise<AgentDecision> {
	const vision = await prepareVisionImage(imageBase64);
	const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;

	if (auth.kind === "antigravity" && !resolveGoogleKey(auth)) {
		return decideWithAntigravityCli({
			auth,
			prompt: fullPrompt,
			imageBase64: vision.base64,
			mediaType: vision.mediaType,
			repairHint,
		});
	}

	if (auth.kind === "cursor") {
		return decideWithCursorCli({
			auth,
			prompt: fullPrompt,
			imageBase64: vision.base64,
			mediaType: vision.mediaType,
			repairHint,
		});
	}

	const { model, label } = await createVisionModel(auth);
	const userText = repairHint ? `${prompt}\n\n${repairHint}` : prompt;

	try {
		const { object } = await generateObject({
			model,
			schema: agentDecisionSchema,
			system: SYSTEM_PROMPT,
			maxOutputTokens: VISION_MAX_TOKENS,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image",
							image: vision.base64,
							mediaType: vision.mediaType,
						},
						{ type: "text", text: userText },
					],
				},
			],
		});
		return object;
	} catch (error) {
		mapProviderError(label, error);
	}
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

	try {
		return await decideWithModel(input.auth, prompt, input.imageBase64);
	} catch (error) {
		if (!(error instanceof AgentProviderError)) throw error;
		if (
			!error.message.includes("did not return JSON") &&
			!error.message.includes("invalid JSON") &&
			!error.message.includes("empty response") &&
			!error.message.includes("not a valid action") &&
			!error.message.includes("truncated while reasoning")
		) {
			throw error;
		}
		return decideWithModel(input.auth, prompt, input.imageBase64, JSON_REPAIR_PROMPT);
	}
}
