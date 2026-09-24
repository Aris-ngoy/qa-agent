import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { extractAgentJsonObject, parseVisionObject } from "../agent-json";
import {
	AgentProviderError,
	completeWithAiSdk,
	isJsonRepairableError,
	prepareVisionImage,
	resolveGoogleKey,
} from "../vision-model";
import { resolveBinary, runCommand } from "./probe";
import type { CommandResult } from "./probe";
import type { VisionCompleteInput, VisionPort } from "./types";

const ANTIGRAVITY_DEFAULT_VISION_MODEL = "gemini-3.5-flash-medium";

const JSON_REPAIR_PROMPT =
	"Your previous reply was not valid JSON for this task. Reply again with ONLY one strict JSON object using double quotes for every key and string (no single quotes, no markdown, no prose).";

/** `agy` markers for "the model turn outlasted --print-timeout, here is partial output". */
const AGY_PRINT_TIMEOUT_RE = /print timeout|turn in progress/i;

/**
 * Resolve the `--model` id from the stored provider setting. Older settings
 * may hold a raw `agy models` row (`"<id>\t<Display name>"`); model ids never
 * contain whitespace, so the first token is always the id the CLI expects.
 */
export function resolveAgyModelId(defaultModel?: string | null): string {
	const firstToken = defaultModel?.trim().split(/\s+/)[0];
	return firstToken || ANTIGRAVITY_DEFAULT_VISION_MODEL;
}

/**
 * Parse `agy --print` output into a decision.
 *
 * Print-timeout partial output is deliberately NOT JSON-repairable: a retry
 * would block for another full print-timeout waiting on the same slow turn
 * (~4+ silent minutes per step), so ANY parse failure on output carrying the
 * print-timeout marker surfaces as a plain provider error the run can fail
 * fast on instead — whether extraction found no JSON at all or the partial
 * JSON failed schema validation.
 */
export function parseAgyDecision<T>(
	schema: VisionCompleteInput<T>["schema"],
	result: CommandResult,
): T {
	const combined = `${result.stdout}\n${result.stderr}`.trim();
	try {
		return parseVisionObject(
			schema,
			extractAgentJsonObject(result.stdout || combined, "Antigravity CLI"),
			"Antigravity CLI",
		);
	} catch (error) {
		if (error instanceof AgentProviderError && AGY_PRINT_TIMEOUT_RE.test(combined)) {
			throw new AgentProviderError(
				"Antigravity CLI print timeout: the model turn exceeded --print-timeout (120s) and only partial output came back. Retry with a faster model or switch the default provider in Settings → Provider.",
			);
		}
		throw error;
	}
}

async function completeWithAgyCli<T>(
	input: VisionCompleteInput<T>,
	repairHint?: string,
): Promise<T> {
	const resolved = await resolveBinary("agy", input.auth.binaryPath);
	if (!resolved.path) {
		throw new AgentProviderError(
			resolved.detail ||
				"Antigravity CLI (`agy`) not found. Install it or paste a Google AI Studio API key.",
		);
	}

	const image = await prepareVisionImage(input.imageBase64);
	const model = resolveAgyModelId(input.auth.defaultModel);
	const ext = image.mediaType === "image/jpeg" ? "jpg" : "png";
	const dir = await mkdtemp(join(tmpdir(), "yoqa-agy-"));
	const shotPath = join(dir, `shot.${ext}`);

	try {
		await writeFile(shotPath, new Uint8Array(Buffer.from(image.base64, "base64")));
		const userText = [
			input.system,
			input.prompt,
			repairHint ? `\n${repairHint}` : "",
			`\nScreenshot file (open and look at it): ${shotPath}`,
			"Reply with ONLY one strict JSON object (double quotes only — no single quotes).",
		].join("\n");

		const result = await runCommand(
			[
				resolved.path,
				"--print",
				userText,
				"--model",
				model,
				"--dangerously-skip-permissions",
				"--print-timeout",
				"120s",
			],
			{ timeoutMs: 130_000 },
		);

		if (result.timedOut) {
			throw new AgentProviderError(
				"Antigravity CLI did not respond within 130s and was killed — the model turn never finished. Retry with a faster model or switch the default provider in Settings → Provider.",
			);
		}

		const combined = `${result.stdout}\n${result.stderr}`.trim();
		if (/not eligible for Antigravity/i.test(combined)) {
			throw new AgentProviderError(
				"Antigravity: this Google account is not eligible. Sign in with another personal account in Antigravity, or use the Google provider with an AI Studio API key.",
			);
		}
		if (result.exitCode !== 0 && !result.stdout.trim()) {
			throw new AgentProviderError(
				combined
					? `Antigravity CLI failed: ${combined.slice(0, 400)}`
					: `Antigravity CLI exited ${result.exitCode}`,
			);
		}

		return parseAgyDecision(input.schema, result);
	} catch (error) {
		if (error instanceof AgentProviderError) throw error;
		if (error instanceof SyntaxError) {
			throw new AgentProviderError(`Antigravity CLI returned invalid JSON: ${error.message}`);
		}
		throw error;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

export const antigravityVision: VisionPort = {
	async completeObject<T>(input: VisionCompleteInput<T>): Promise<T> {
		const apiKey = resolveGoogleKey(input.auth);
		if (apiKey) {
			const requested = input.auth.defaultModel?.trim() || ANTIGRAVITY_DEFAULT_VISION_MODEL;
			const googleModelId =
				requested.startsWith("gemini-1.") || requested.startsWith("gemini-2.")
					? requested
					: "gemini-2.5-flash";
			const image = await prepareVisionImage(input.imageBase64);
			const provider = createGoogleGenerativeAI({ apiKey });
			return completeWithAiSdk({
				label: "Antigravity",
				model: provider(googleModelId),
				schema: input.schema,
				system: input.system,
				prompt: input.prompt,
				image,
			});
		}

		try {
			return await completeWithAgyCli(input);
		} catch (error) {
			if (!(error instanceof AgentProviderError) || !isJsonRepairableError(error)) {
				throw error;
			}
			return completeWithAgyCli(input, JSON_REPAIR_PROMPT);
		}
	},
};
