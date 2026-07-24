import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ActiveProviderAuth } from "./application";
import { ANTIGRAVITY_DEFAULT_VISION_MODEL } from "./drivers/antigravity";
import { resolveBinary, runCommand } from "./drivers/probe";
import { AgentProviderError } from "./vision-model";

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

export type AntigravityDecision = z.infer<typeof agentDecisionSchema>;

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1]?.trim() ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new AgentProviderError(
			`Antigravity CLI did not return JSON (got: ${trimmed.replace(/\s+/g, " ").slice(0, 160)})`,
		);
	}
	return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

/**
 * Vision decide via `agy --print` (Antigravity CLI). Writes the screenshot to a
 * temp file and asks the model to inspect that path — Antigravity has no image flag.
 */
export async function decideWithAntigravityCli(input: {
	auth: ActiveProviderAuth;
	prompt: string;
	imageBase64: string;
	mediaType: "image/png" | "image/jpeg";
	repairHint?: string;
}): Promise<AntigravityDecision> {
	const resolved = await resolveBinary("agy", input.auth.binaryPath);
	if (!resolved.path) {
		throw new AgentProviderError(
			resolved.detail ||
				"Antigravity CLI (`agy`) not found. Install it or paste a Google AI Studio API key.",
		);
	}

	const model = input.auth.defaultModel?.trim() || ANTIGRAVITY_DEFAULT_VISION_MODEL;
	const ext = input.mediaType === "image/jpeg" ? "jpg" : "png";
	const dir = await mkdtemp(join(tmpdir(), "yoqa-agy-"));
	const shotPath = join(dir, `shot.${ext}`);

	try {
		await writeFile(shotPath, new Uint8Array(Buffer.from(input.imageBase64, "base64")));
		const userText = [
			input.prompt,
			input.repairHint ? `\n${input.repairHint}` : "",
			`\nScreenshot file (open and look at it): ${shotPath}`,
			"Reply with ONLY one JSON action object.",
		].join("");

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

		const parsed = agentDecisionSchema.parse(extractJsonObject(result.stdout || combined));
		return parsed;
	} catch (error) {
		if (error instanceof AgentProviderError) throw error;
		if (error instanceof z.ZodError) {
			throw new AgentProviderError(`Antigravity JSON was not a valid action: ${error.message}`);
		}
		if (error instanceof SyntaxError) {
			throw new AgentProviderError(`Antigravity CLI returned invalid JSON: ${error.message}`);
		}
		throw error;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
