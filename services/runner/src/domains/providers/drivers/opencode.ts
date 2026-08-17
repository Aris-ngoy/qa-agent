import { createOpenAI } from "@ai-sdk/openai";
import {
	AgentProviderError,
	createSdkVisionPort,
	readOpenCodeCliAuthKeyForProvider,
	resolveOpenAiCompatibleKey,
	withOpenCodeRequestHooks,
} from "../vision-model";
import { loadOpenCodeUserConfig, resolveOpenCodeCompatibleAuth } from "./opencode-config";
import { pingOpenAiCompatible, probeCli, resolveBinary, runCommand } from "./probe";
import type { DriverDefinition, ModelEntry, ProbeResult } from "./types";

/** Default OpenCode model for screenshot / vision QA runs. */
/** Free Zen model verified to accept screenshot `image_url` payloads (Aug 2026). */
export const OPENCODE_DEFAULT_VISION_MODEL = "mimo-v2.5-free";

/** Display names matching OpenCode's provider directory (Amazon Bedrock, OpenCode Zen, …). */
const OPENCODE_PROVIDER_LABELS: Record<string, string> = {
	"amazon-bedrock": "Amazon Bedrock",
	anthropic: "Anthropic",
	azure: "Azure OpenAI",
	"github-copilot": "GitHub Copilot",
	google: "Google",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	litellm: "LiteLLM",
	ollama: "Ollama",
	openai: "OpenAI",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openrouter: "OpenRouter",
	xai: "xAI",
	zenmux: "ZenMux",
};

export function humanizeOpenCodeProvider(providerId: string): string {
	const known = OPENCODE_PROVIDER_LABELS[providerId];
	if (known) return known;
	return providerId
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => {
			if (part.toLowerCase() === "ai") return "AI";
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join(" ");
}

export function parseOpenCodeModelSlug(slug: string): { providerId: string; modelId: string } {
	const trimmed = slug.trim();
	const sep = trimmed.indexOf("/");
	if (sep <= 0 || sep === trimmed.length - 1) {
		return { providerId: "opencode", modelId: trimmed };
	}
	return {
		providerId: trimmed.slice(0, sep),
		modelId: trimmed.slice(sep + 1),
	};
}

export function isOpenCodeZenModel(slug: string): boolean {
	return parseOpenCodeModelSlug(slug).providerId === "opencode";
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

export function toOpenCodeModelEntry(slug: string): ModelEntry {
	const trimmed = slug.trim();
	const { providerId, modelId } = parseOpenCodeModelSlug(trimmed);
	return {
		id: trimmed,
		name: humanizeModelId(modelId),
		provider: humanizeOpenCodeProvider(providerId),
	};
}

export function groupOpenCodeModelsByProvider(
	models: ModelEntry[],
): Array<{ provider: string; models: ModelEntry[] }> {
	const buckets = new Map<string, ModelEntry[]>();
	const order: string[] = [];
	for (const model of models) {
		const provider = model.provider?.trim() || humanizeOpenCodeProvider("opencode");
		const existing = buckets.get(provider);
		if (existing) {
			existing.push(model);
		} else {
			buckets.set(provider, [model]);
			order.push(provider);
		}
	}
	const zen = humanizeOpenCodeProvider("opencode");
	order.sort((a, b) => {
		if (a === zen && b !== zen) return -1;
		if (b === zen && a !== zen) return 1;
		return a.localeCompare(b);
	});
	return order.map((provider) => ({
		provider,
		models: buckets.get(provider) ?? [],
	}));
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
	return parseOpenCodeModelSlug(slug).modelId;
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
				models.push(toOpenCodeModelEntry(item.id));
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
		if (seen.has(slug)) continue;
		seen.add(slug);
		models.push(toOpenCodeModelEntry(slug));
	}
	return {
		models,
		detail: `${models.length} models from opencode CLI`,
	};
}

async function resolveCompatibleOpenCodeVision(
	providerId: string,
	auth: {
		baseUrl: string | null;
		env: Record<string, string>;
	},
) {
	const config = await loadOpenCodeUserConfig();
	const storedKey = await readOpenCodeCliAuthKeyForProvider(providerId);
	return resolveOpenCodeCompatibleAuth({
		providerId,
		config,
		env: auth.env,
		storedKey,
		overrideBaseUrl: auth.baseUrl,
	});
}

export const opencodeDriver: DriverDefinition = {
	kind: "opencode",
	label: "OpenCode",
	description:
		"OpenCode Zen or LiteLLM (OpenAI-compatible). Paste a Zen API key for Zen; LiteLLM uses opencode.json.",
	defaultBinary: "opencode",
	authModes: ["cli", "api_key"],
	envHints: [
		"OPENCODE_API_KEY",
		"OPENCODE_ZEN_API_KEY",
		"OPENCODE_SERVER_PASSWORD",
		"LITELLM_API_KEY",
	],
	loginInstructions:
		"Paste a Zen API key from https://opencode.ai for Zen vision. LiteLLM uses ~/.config/opencode/opencode.json plus CLI auth or LITELLM_API_KEY. Local `opencode serve` is not OpenAI-compatible.",
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "OpenCode",
		defaultModel: OPENCODE_DEFAULT_VISION_MODEL,
		createModel: async (auth, modelId) => {
			if (isOpenCodeZenModel(modelId)) {
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
				}).chat(stripOpenCodeModelSlug(modelId));
			}

			const { providerId } = parseOpenCodeModelSlug(modelId);
			const providerLabel = humanizeOpenCodeProvider(providerId);
			const compatible = await resolveCompatibleOpenCodeVision(providerId, auth);
			if (compatible?.apiKey) {
				return createOpenAI({
					apiKey: compatible.apiKey,
					baseURL: compatible.baseURL,
					name: providerId,
					fetch: withOpenCodeRequestHooks({
						disableThinking: false,
						stripResponseFormat: true,
						authHeaders: null,
						extraHeaders: Object.keys(compatible.headers).length > 0 ? compatible.headers : null,
					}),
				}).chat(stripOpenCodeModelSlug(modelId));
			}
			if (compatible && !compatible.apiKey) {
				throw new AgentProviderError(
					`${providerLabel} vision needs an API key. OpenCode stores it in auth.json after login, or set ${providerId.replace(/-/g, "_").toUpperCase()}_API_KEY in Settings → Provider.`,
				);
			}
			if (providerId === "litellm") {
				throw new AgentProviderError(
					"Yoqa vision can use LiteLLM via OpenCode. Add provider.litellm.options.baseURL in ~/.config/opencode/opencode.json, then pick litellm/… in Settings → Provider.",
				);
			}
			throw new AgentProviderError(
				`Yoqa vision uses OpenCode Zen or LiteLLM. "${modelId}" is a ${providerLabel} model. Pick an OpenCode Zen or LiteLLM model in Settings → Provider.`,
			);
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

		const cli = await listOpenCodeModelsFromCli(input.binaryPath);
		if (cli.models.length > 0) {
			return { models: cli.models, message: cli.detail };
		}

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
				models: (result.models ?? []).map((id) => toOpenCodeModelEntry(id)),
				message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
			};
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
