import { antigravityVision } from "./antigravity-vision";
import { probeCli, runCommand } from "./probe";
import type { DriverDefinition } from "./types";

const FALLBACK_MODELS = [
	"gemini-3.5-flash-medium",
	"gemini-3.5-flash-low",
	"gemini-3.1-pro-low",
	"claude-sonnet-4-6",
];

export const ANTIGRAVITY_DEFAULT_VISION_MODEL = "gemini-3.5-flash-medium";

/**
 * Parse `agy models` stdout into `{id, name}` rows. Each model prints as
 * `<id>\t<Display name>`; progress/header lines ("Fetching available
 * models...", "usage: ...") carry no tab and are skipped. Taking the whole
 * line as the id would persist `"id\tName"` into settings and later fail
 * `--model` validation in the CLI.
 */
export function parseAgyModelsOutput(stdout: string): Array<{ id: string; name: string }> {
	const models: Array<{ id: string; name: string }> = [];
	for (const raw of (stdout || "").split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const lower = line.toLowerCase();
		if (lower.startsWith("usage") || lower.startsWith("fetching")) continue;
		const tab = line.indexOf("\t");
		if (tab < 0) continue;
		const id = line.slice(0, tab).trim();
		if (!id) continue;
		models.push({ id, name: line.slice(tab + 1).trim() || id });
	}
	return models;
}

async function listAgyModels(binary: string): Promise<Array<{ id: string; name: string }>> {
	const result = await runCommand([binary, "models"], { timeoutMs: 15_000 });
	if (result.exitCode !== 0) return [];
	return parseAgyModelsOutput(result.stdout);
}

export const antigravityDriver: DriverDefinition = {
	kind: "antigravity",
	label: "Antigravity",
	description:
		"Google Antigravity CLI (`agy`). Lists models via `agy models`; vision uses `agy --print` or a Google AI Studio API key fallback.",
	defaultBinary: "agy",
	authModes: ["cli", "api_key"],
	envHints: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
	loginInstructions:
		"Install Antigravity CLI (`agy`). Sign in via the Antigravity app/IDE, or paste a Google AI Studio API key for vision if your account is not eligible for Antigravity.",
	capabilities: { vision: true, judge: false },
	vision: antigravityVision,
	async probe(binaryPath) {
		return probeCli({
			defaultBinary: "agy",
			binaryPath,
			versionArgs: ["--version"],
			authCheck: async (binary) => {
				const models = await listAgyModels(binary);
				if (models.length > 0) {
					return {
						authenticated: true,
						detail: `Antigravity CLI found · ${models.length} models`,
					};
				}
				return {
					authenticated: true,
					detail:
						"Antigravity CLI found — sign in via Antigravity if vision/`agy -p` fails eligibility",
				};
			},
		});
	},
	async validate(input) {
		const key =
			input.apiKey || input.env.GOOGLE_GENERATIVE_AI_API_KEY || input.env.GOOGLE_API_KEY || null;
		if (key) {
			try {
				const response = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
				);
				if (!response.ok) {
					const detail = await response.text().catch(() => "");
					return {
						ok: false,
						status: "invalid",
						message: detail
							? `Google AI key invalid (${response.status}): ${detail.slice(0, 200)}`
							: `Google AI key invalid: HTTP ${response.status}`,
					};
				}
				return {
					ok: true,
					status: "connected",
					message: "Google AI API key is valid (Antigravity fallback path)",
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, status: "invalid", message };
			}
		}
		const probe = await this.probe(input.binaryPath);
		if (!probe.found) {
			return { ok: false, status: "not_found", message: probe.detail };
		}
		return {
			ok: true,
			status: "connected",
			message: probe.detail,
		};
	},
	async listModels(input) {
		const key =
			input.apiKey || input.env.GOOGLE_GENERATIVE_AI_API_KEY || input.env.GOOGLE_API_KEY || null;
		const probe = await this.probe(input.binaryPath);
		if (probe.found && probe.binaryPath) {
			const models = await listAgyModels(probe.binaryPath);
			if (models.length > 0) {
				return {
					models,
					message: `${models.length} Antigravity models`,
				};
			}
		}
		if (key) {
			return {
				models: FALLBACK_MODELS.map((id) => ({ id, name: id })),
				message: `${FALLBACK_MODELS.length} fallback models (CLI list unavailable)`,
			};
		}
		return {
			models: FALLBACK_MODELS.map((id) => ({ id, name: id })),
			message: probe.found
				? "Using fallback model list"
				: probe.detail || "Antigravity CLI not found",
		};
	},
};
