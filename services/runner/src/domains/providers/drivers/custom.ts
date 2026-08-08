import { pingOpenAiCompatible } from "./probe";
import type { DriverDefinition } from "./types";

function normalizeBaseUrl(baseUrl: string | null | undefined): string | null {
	const raw = baseUrl?.trim();
	if (!raw) return null;
	return raw.replace(/\/$/, "");
}

export const customDriver: DriverDefinition = {
	kind: "custom",
	label: "Custom",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["OPENAI_API_KEY"],
	loginInstructions:
		"Point Base URL at an OpenAI-compatible /v1 endpoint (Ollama, LM Studio, gateway). API key is optional for local hosts.",
	async probe() {
		return {
			found: true,
			version: null,
			authenticated: null,
			detail: "Custom OpenAI-compatible endpoint — set Base URL",
			binaryPath: null,
		};
	},
	async validate(input) {
		const base = normalizeBaseUrl(input.baseUrl);
		if (!base) {
			return {
				ok: false,
				status: "invalid",
				message: "Base URL is required for a custom OpenAI-compatible provider",
			};
		}
		const key = input.apiKey?.trim() || input.env.OPENAI_API_KEY?.trim() || null;
		const result = await pingOpenAiCompatible({
			apiKey: key ?? "",
			baseUrl: base,
			label: "Custom",
			allowEmptyApiKey: true,
		});
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const base = normalizeBaseUrl(input.baseUrl);
		if (!base) {
			return { models: [], message: "Base URL required to list models" };
		}
		const key = input.apiKey?.trim() || input.env.OPENAI_API_KEY?.trim() || null;
		const result = await pingOpenAiCompatible({
			apiKey: key ?? "",
			baseUrl: base,
			label: "Custom",
			allowEmptyApiKey: true,
		});
		return {
			models: (result.models ?? []).map((id) => ({ id, name: id })),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
