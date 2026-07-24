import { pingOpenAiCompatible, probeCli } from "./probe";
import type { DriverDefinition, ModelEntry } from "./types";

/** Free Zen models that do not use a `-free` suffix in their id. */
const OPENCODE_FREE_MODEL_IDS = new Set(["big-pickle"]);

/** Default OpenCode model for screenshot / vision QA runs. */
export const OPENCODE_DEFAULT_VISION_MODEL = "deepseek-v4-flash-free";

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
	return input.apiKey || input.env.OPENCODE_API_KEY || input.env.OPENCODE_ZEN_API_KEY || null;
}

export const opencodeDriver: DriverDefinition = {
	kind: "opencode",
	label: "OpenCode",
	defaultBinary: "opencode",
	authModes: ["cli", "api_key"],
	envHints: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
	loginInstructions:
		"Install OpenCode, set OPENCODE_API_KEY (from opencode.ai/auth), or point Server URL at a local OpenCode server.",
	async probe(binaryPath) {
		return probeCli({
			defaultBinary: "opencode",
			binaryPath,
		});
	},
	async validate(input) {
		const key = resolveOpenCodeKey(input);
		const serverUrl = input.serverUrl?.trim() || null;

		if (serverUrl) {
			const password = input.env.OPENCODE_SERVER_PASSWORD || input.env.SERVER_PASSWORD || "";
			try {
				const headers: Record<string, string> = {};
				if (password) {
					headers.Authorization = `Bearer ${password}`;
				}
				const response = await fetch(`${serverUrl.replace(/\/$/, "")}/health`, {
					method: "GET",
					headers,
				}).catch(async () => fetch(`${serverUrl.replace(/\/$/, "")}/`, { method: "GET", headers }));
				if (response.ok || response.status === 404) {
					return {
						ok: true,
						status: "connected",
						message: `OpenCode server reachable at ${serverUrl}`,
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
		if (probe.found) {
			return {
				ok: true,
				status: "connected",
				message: `OpenCode CLI found${probe.version ? ` · ${probe.version}` : ""} — add OPENCODE_API_KEY for hosted catalogs`,
			};
		}
		if (key) {
			return {
				ok: true,
				status: "connected",
				message: "OpenCode API key stored (CLI not on PATH)",
			};
		}
		return {
			ok: false,
			status: "invalid",
			message: "Provide an OpenCode API key, local server URL, or install the `opencode` CLI",
		};
	},
	async listModels(input) {
		const key = resolveOpenCodeKey(input);
		const serverUrl = input.serverUrl?.trim() || null;

		if (serverUrl) {
			try {
				const password = input.env.OPENCODE_SERVER_PASSWORD || input.env.SERVER_PASSWORD || "";
				const headers: Record<string, string> = {};
				if (password) headers.Authorization = `Bearer ${password}`;
				if (key) headers.Authorization = `Bearer ${key}`;
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
				models: (result.models ?? []).map(toOpenCodeModelEntry),
				message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
			};
		}

		return {
			models: [],
			message: "Add OPENCODE_API_KEY or a server URL to list models",
		};
	},
};
