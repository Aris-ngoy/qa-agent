import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { extractAgentJsonObject } from "./agent-json";
import type { ActiveProviderAuth } from "./application";
import { CURSOR_DEFAULT_VISION_MODEL } from "./drivers/cursor";
import { resolveBinary, runCommand } from "./drivers/probe";
import { AgentProviderError } from "./vision-model";

export { CURSOR_DEFAULT_VISION_MODEL };

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
	ms: z.number().min(0).max(10_000).optional(),
	reason: z.string().min(1),
	thoughts: z.string().min(1),
});

const groundResultSchema = z.object({
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
});

export type CursorDecision = z.infer<typeof agentDecisionSchema>;

function extractJsonObject(text: string): unknown {
	return extractAgentJsonObject(text, "Cursor Agent CLI");
}

function resolveCursorApiKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.CURSOR_API_KEY?.trim() ||
		process.env.CURSOR_API_KEY?.trim() ||
		null
	);
}

async function invokeCursorPrint(input: {
	auth: ActiveProviderAuth;
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

/**
 * Vision decide via `cursor-agent --print` (ask mode). Writes the screenshot to a
 * temp workspace and asks the model to inspect that path — Cursor has no image flag.
 */
export async function decideWithCursorCli(input: {
	auth: ActiveProviderAuth;
	prompt: string;
	imageBase64: string;
	mediaType: "image/png" | "image/jpeg";
	repairHint?: string;
}): Promise<CursorDecision> {
	const ext = input.mediaType === "image/jpeg" ? "jpg" : "png";
	const shotName = `shot.${ext}`;
	const userText = [
		input.prompt,
		input.repairHint ? `\n${input.repairHint}` : "",
		`\nScreenshot file (open and look at it): ${shotName}`,
		"The absolute path is in the current workspace. Open that image and base your answer on what you see.",
		'Reply with ONLY one strict JSON action object (double quotes only, e.g. {"type":"tap",...}) — no single quotes, no markdown fences, no commentary.',
	].join("");

	try {
		const stdout = await invokeCursorPrint({
			auth: input.auth,
			prompt: userText,
			imageBase64: input.imageBase64,
			mediaType: input.mediaType,
		});
		return agentDecisionSchema.parse(extractJsonObject(stdout));
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

/**
 * Element grounding via the same Cursor Agent print path.
 */
export async function groundWithCursorCli(input: {
	auth: ActiveProviderAuth;
	prompt: string;
	imageBase64: string;
	mediaType: "image/png" | "image/jpeg";
}): Promise<{ x: number; y: number }> {
	const ext = input.mediaType === "image/jpeg" ? "jpg" : "png";
	const shotName = `shot.${ext}`;
	const userText = [
		input.prompt,
		`\nScreenshot file (open and look at it): ${shotName}`,
		'Reply with ONLY strict JSON (double quotes): {"x":0-1000,"y":0-1000} — no single quotes, no markdown, no commentary.',
	].join("");

	try {
		const stdout = await invokeCursorPrint({
			auth: input.auth,
			prompt: userText,
			imageBase64: input.imageBase64,
			mediaType: input.mediaType,
		});
		return groundResultSchema.parse(extractJsonObject(stdout));
	} catch (error) {
		if (error instanceof AgentProviderError) throw error;
		if (error instanceof z.ZodError) {
			throw new AgentProviderError(`Cursor grounding JSON was invalid: ${error.message}`);
		}
		if (error instanceof SyntaxError) {
			throw new AgentProviderError(`Cursor Agent CLI returned invalid JSON: ${error.message}`);
		}
		throw error;
	}
}
