import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { extractAgentJsonObject } from "../agent-json";
import { AgentProviderError, isJsonRepairableError, prepareVisionImage } from "../vision-model";
import { resolveBinary, runCommand } from "./probe";
import type { VisionAuth, VisionCompleteInput, VisionPort } from "./types";

const CURSOR_DEFAULT_VISION_MODEL = "auto";

const JSON_REPAIR_PROMPT =
	"Your previous reply was not valid JSON for this task. Reply again with ONLY one strict JSON object using double quotes for every key and string (no single quotes, no markdown, no prose).";

function resolveCursorApiKey(auth: VisionAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.CURSOR_API_KEY?.trim() ||
		process.env.CURSOR_API_KEY?.trim() ||
		null
	);
}

async function invokeCursorPrint(input: {
	auth: VisionAuth;
	prompt: string;
	imageBase64: string;
	mediaType: "image/png" | "image/jpeg";
}): Promise<string> {
	const resolved = await resolveBinary("cursor-agent", input.auth.binaryPath);
	if (!resolved.path) {
		throw new AgentProviderError(
			resolved.detail ||
				"Cursor Agent CLI (`cursor-agent`) not found. Install it or paste a CURSOR_API_KEY.",
		);
	}

	const model = input.auth.defaultModel?.trim() || CURSOR_DEFAULT_VISION_MODEL;
	const ext = input.mediaType === "image/jpeg" ? "jpg" : "png";
	const dir = await mkdtemp(join(tmpdir(), "yoqa-cursor-"));
	const shotPath = join(dir, `shot.${ext}`);
	const apiKey = resolveCursorApiKey(input.auth);

	try {
		await writeFile(shotPath, new Uint8Array(Buffer.from(input.imageBase64, "base64")));

		const args = [
			resolved.path,
			"-p",
			"--mode",
			"ask",
			"--trust",
			"--force",
			"--workspace",
			dir,
			"--model",
			model,
			"--output-format",
			"text",
		];
		if (apiKey) {
			args.push("--api-key", apiKey);
		}
		args.push(input.prompt);

		const result = await runCommand(args, {
			timeoutMs: 130_000,
			env: apiKey ? { CURSOR_API_KEY: apiKey } : undefined,
		});

		const combined = `${result.stdout}\n${result.stderr}`.trim();
		const lower = combined.toLowerCase();
		if (
			lower.includes("unauthorized") ||
			lower.includes("unauthenticated") ||
			lower.includes("not logged") ||
			lower.includes("authentication required")
		) {
			throw new AgentProviderError(
				"Cursor Agent is not authenticated. Run `cursor-agent login` or paste a CURSOR_API_KEY in Settings.",
			);
		}
		if (result.exitCode !== 0 && !result.stdout.trim()) {
			throw new AgentProviderError(
				combined
					? `Cursor Agent CLI failed: ${combined.slice(0, 400)}`
					: `Cursor Agent CLI exited ${result.exitCode}`,
			);
		}

		return result.stdout.trim() || combined;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function completeOnce<T>(input: VisionCompleteInput<T>, repairHint?: string): Promise<T> {
	const image = await prepareVisionImage(input.imageBase64);
	const ext = image.mediaType === "image/jpeg" ? "jpg" : "png";
	const shotName = `shot.${ext}`;
	const userText = [
		input.system,
		input.prompt,
		repairHint ? `\n${repairHint}` : "",
		`\nScreenshot file (open and look at it): ${shotName}`,
		"The absolute path is in the current workspace. Open that image and base your answer on what you see.",
		"Reply with ONLY one strict JSON object (double quotes only) — no single quotes, no markdown fences, no commentary.",
	].join("\n");

	try {
		const stdout = await invokeCursorPrint({
			auth: input.auth,
			prompt: userText,
			imageBase64: image.base64,
			mediaType: image.mediaType,
		});
		return input.schema.parse(extractAgentJsonObject(stdout, "Cursor Agent CLI"));
	} catch (error) {
		if (error instanceof AgentProviderError) throw error;
		if (error instanceof z.ZodError) {
			throw new AgentProviderError(`Cursor JSON was not a valid action: ${error.message}`);
		}
		if (error instanceof SyntaxError) {
			throw new AgentProviderError(`Cursor Agent CLI returned invalid JSON: ${error.message}`);
		}
		throw error;
	}
}

export const cursorVision: VisionPort = {
	async completeObject<T>(input: VisionCompleteInput<T>): Promise<T> {
		try {
			return await completeOnce(input);
		} catch (error) {
			if (!(error instanceof AgentProviderError) || !isJsonRepairableError(error)) {
				throw error;
			}
			return completeOnce(input, JSON_REPAIR_PROMPT);
		}
	},
};
