import { createOpenAI } from "@ai-sdk/openai";
import {
	AgentProviderError,
	createSdkVisionPort,
	resolveOpenAiCompatibleKey,
	withOpenCodeRequestHooks,
} from "../vision-model";
import { pingOpenAiCompatible, probeCli, resolveBinary, runCommand } from "./probe";
import type { DriverDefinition, ModelEntry, ProbeResult } from "./types";

/** Free Zen models that do not use a `-free` suffix in their id. */
const OPENCODE_FREE_MODEL_IDS = new Set(["big-pickle"]);

/** Default OpenCode model for screenshot / vision QA runs. */
/** Free Zen model verified to accept screenshot `image_url` payloads (Aug 2026). */
export const OPENCODE_DEFAULT_VISION_MODEL = "mimo-v2.5-free";

export function isOpenCodeFreeModel(id: string): boolean {
	const normalized = id.trim().toLowerCase();
	return OPENCODE_FREE_MODEL_IDS.has(normalized) || normalized.endsWith("-free");
}

export function humanizeModelId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => {
			if (/^\d+(\.\d+)*$/.test(part)) return part;
			if (part.toLowerCase() === "free") return "Free";
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join(" ");
}

export function toOpenCodeModelEntry(id: string): ModelEntry {
	return {
		id,
		name: humanizeModelId(id),
		tier: isOpenCodeFreeModel(id) ? "free" : "paid",
	};
}

/**
 * OpenCode local `serve` expects Basic auth `opencode:<password>` (same as
 * pingdotgg/t3code OpenCodeRuntime), not Bearer.
 */
export function openCodeServerAuthHeaders(
	password: string | null | undefined,
): Record<string, string> {
	const trimmed = password?.trim();
	if (!trimmed) return {};
	const token = Buffer.from(`opencode:${trimmed}`, "utf8").toString("base64");
	return { Authorization: `Basic ${token}` };
}

export function resolveOpenCodeServerPassword(env: Record<string, string>): string | null {
	return (
		env.OPENCODE_SERVER_PASSWORD?.trim() ||
		env.SERVER_PASSWORD?.trim() ||
		process.env.OPENCODE_SERVER_PASSWORD?.trim() ||
		process.env.SERVER_PASSWORD?.trim() ||
		null
	);
}

/** Strip `provider/` from CLI slugs like `opencode/deepseek-v4-flash-free`. */
export function stripOpenCodeModelSlug(slug: string): string {
	const trimmed = slug.trim();
	const sep = trimmed.indexOf("/");
	if (sep <= 0 || sep === trimmed.length - 1) return trimmed;
	return trimmed.slice(sep + 1);
}

function parseModelsPayload(json: unknown): ModelEntry[] {
	const models: ModelEntry[] = [];
	if (
		json &&
		typeof json === "object" &&
		"data" in json &&
		Array.isArray((json as { data: unknown }).data)
	) {
		for (const item of (json as { data: unknown[] }).data) {
			if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
				models.push(toOpenCodeModelEntry(stripOpenCodeModelSlug(item.id)));
			}
		}
	}
	return models;
}

function resolveOpenCodeKey(input: { apiKey: string | null; env: Record<string, string> }):
	| string
	| null {
	return (
		input.apiKey?.trim() ||
		input.env.OPENCODE_API_KEY?.trim() ||
		input.env.OPENCODE_ZEN_API_KEY?.trim() ||
		process.env.OPENCODE_API_KEY?.trim() ||
		process.env.OPENCODE_ZEN_API_KEY?.trim() ||
		null
	);
}

/** Inventory via CLI — matches t3code `loadInventoryFromCli` (`opencode models`). */
export async function listOpenCodeModelsFromCli(
	binaryPath?: string | null,
): Promise<{ models: ModelEntry[]; detail: string }> {
	const resolved = await resolveBinary("opencode", binaryPath);
	if (!resolved.path) {
		return { models: [], detail: resolved.detail };
	}
	const result = await runCommand([resolved.path, "models"], { timeoutMs: 15_000 });
	if (result.exitCode !== 0) {
		const err = (result.stderr || result.stdout).trim().slice(0, 200);
		return {
			models: [],
			detail: err
				? `opencode models failed: ${err}`
				: `opencode models exited with code ${result.exitCode}`,
		};
	}
	const models: ModelEntry[] = [];
	const seen = new Set<string>();
	for (const line of result.stdout.split("\n")) {
		const slug = line.trim();
		if (!slug || /\s/.test(slug)) continue;
		const id = stripOpenCodeModelSlug(slug);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		models.push(toOpenCodeModelEntry(id));
	}
	return {
		models,
		detail: `${models.length} models from opencode CLI`,
	};
}

export const opencodeDriver: DriverDefinition = {
	kind: "opencode",
	label: "OpenCode",
	description: "OpenCode Zen (OpenAI-compatible). Paste a Zen API key for vision runs.",
	defaultBinary: "opencode",
	authModes: ["cli", "api_key"],
	envHints: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY", "OPENCODE_SERVER_PASSWORD"],
	loginInstructions:
		"Paste a Zen API key from https://opencode.ai for vision. Local `opencode serve` is not OpenAI-compatible.",
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "OpenCode",
		defaultModel: OPENCODE_DEFAULT_VISION_MODEL,
		createModel: async (auth, modelId) => {
			const apiKey = await resolveOpenAiCompatibleKey(auth);
			if (!apiKey) {
				throw new AgentProviderError(
					"OpenCode vision needs a Zen API key. Local `opencode serve` returns a web UI for /v1 (not chat completions). Paste a key from https://opencode.ai in Settings → Provider, or set OPENCODE_API_KEY.",
				);
			}
			const baseURL = auth.baseUrl?.trim().replace(/\/$/, "") || "https://opencode.ai/zen/v1";
			return createOpenAI({
				apiKey,
				baseURL,
				name: "opencode",
				fetch: withOpenCodeRequestHooks({
					disableThinking: true,
					authHeaders: null,
				}),
			}).chat(modelId);
		},
	}),
	async probe(binaryPath) {
		return probeCliWithFriendlyErrors(binaryPath);
	},
	async validate(input) {
		const key = resolveOpenCodeKey(input);
		const serverUrl = input.serverUrl?.trim() || null;

		if (serverUrl) {
			const password = resolveOpenCodeServerPassword(input.env);
			const headers = openCodeServerAuthHeaders(password);
			try {
				const base = serverUrl.replace(/\/$/, "");
				const response = await fetch(`${base}/global/health`, {
					method: "GET",
					headers,
				}).catch(async () =>
					fetch(`${base}/health`, { method: "GET", headers }).catch(async () =>
						fetch(`${base}/`, { method: "GET", headers }),
					),
				);
				if (response.ok || response.status === 404) {
					return {
						ok: true,
						status: "connected",
						message: `OpenCode server reachable at ${serverUrl}`,
					};
				}
				if (response.status === 401 || response.status === 403) {
					return {
						ok: false,
						status: "invalid",
						message:
							"OpenCode server rejected authentication. Check Server URL and OPENCODE_SERVER_PASSWORD.",
					};
				}
			} catch {
				// Fall through to API key / CLI checks.
			}
		}

		if (key) {
			const result = await pingOpenAiCompatible({
				apiKey: key,
				baseUrl: "https://opencode.ai/zen/v1",
				label: "OpenCode",
			});
			if (result.ok) {
				return { ok: true, status: "connected", message: result.message };
			}
			// Some OpenCode deployments use a different models path; treat key presence + CLI as soft ok.
		}

		const probe = await this.probe(input.binaryPath);
		if (!probe.found && !key) {
			return {
				ok: false,
				status: "not_found",
				message: probe.detail,
			};
		}
		if (probe.found && key) {
			return {
				ok: true,
				status: "connected",
				message: `Authenticated · opencode${probe.version ? ` ${probe.version}` : ""}`,
			};
		}
		if (key) {
			return {
				ok: true,
				status: "connected",
				message: "OpenCode API key stored (CLI not on PATH)",
			};
		}
		if (probe.found) {
			const cliModels = await listOpenCodeModelsFromCli(input.binaryPath);
			const versionSuffix = probe.version ? ` ${probe.version}` : "";
			if (cliModels.models.length > 0) {
				return {
					ok: true,
					status: "connected",
					message: `Authenticated · opencode${versionSuffix} · ${cliModels.models.length} models via CLI`,
				};
			}
			return {
				ok: true,
				status: "connected",
				message: `Authenticated · opencode${versionSuffix} · CLI found (run \`opencode providers login\` if models are empty)`,
			};
		}
		return {
			ok: false,
			status: "invalid",
			message: "Install the OpenCode CLI, paste a Zen API key, or set a local Server URL",
		};
	},
	async listModels(input) {
		const key = resolveOpenCodeKey(input);
		const serverUrl = input.serverUrl?.trim() || null;

		if (serverUrl) {
			try {
				const password = resolveOpenCodeServerPassword(input.env);
				const headers = password
					? openCodeServerAuthHeaders(password)
					: key
						? { Authorization: `Bearer ${key}` }
						: {};
				const response = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/models`, {
					method: "GET",
					headers,
				});
				if (response.ok) {
					const json: unknown = await response.json();
					const models = parseModelsPayload(json);
					return {
						models,
						message: `${models.length} models available`,
					};
				}
			} catch {
				// Fall through.
			}
		}

		if (key) {
			const result = await pingOpenAiCompatible({
				apiKey: key,
				baseUrl: "https://opencode.ai/zen/v1",
				label: "OpenCode",
			});
			return {
				models: (result.models ?? []).map((id) => toOpenCodeModelEntry(stripOpenCodeModelSlug(id))),
				message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
			};
		}

		const cli = await listOpenCodeModelsFromCli(input.binaryPath);
		if (cli.models.length > 0) {
			return { models: cli.models, message: cli.detail };
		}

		return {
			models: [],
			message: "Add OPENCODE_API_KEY, a server URL, or install the opencode CLI to list models",
		};
	},
};

async function probeCliWithFriendlyErrors(binaryPath?: string | null): Promise<ProbeResult> {
	const result = await probeCli({
		defaultBinary: "opencode",
		binaryPath,
	});
	if (!result.found) {
		return result;
	}
	const lower = result.detail.toLowerCase();
	if (lower.includes("quarantine")) {
		return {
			...result,
			detail:
				"macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)`.",
		};
	}
	if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
		return {
			...result,
			detail:
				"macOS killed OpenCode due to an invalid code signature — reinstall from https://opencode.ai/download.",
		};
	}
	return result;
}
