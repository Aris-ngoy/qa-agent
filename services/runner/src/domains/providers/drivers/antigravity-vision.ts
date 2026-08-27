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
import type { VisionCompleteInput, VisionPort } from "./types";

const ANTIGRAVITY_DEFAULT_VISION_MODEL = "gemini-3.5-flash-medium";

const JSON_REPAIR_PROMPT =
	"Your previous reply was not valid JSON for this task. Reply again with ONLY one strict JSON object using double quotes for every key and string (no single quotes, no markdown, no prose).";

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
	const model = input.auth.defaultModel?.trim() || ANTIGRAVITY_DEFAULT_VISION_MODEL;
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

		return parseVisionObject(
			input.schema,
			extractAgentJsonObject(result.stdout || combined, "Antigravity CLI"),
			"Antigravity CLI",
		);
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
