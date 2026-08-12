import { pingOpenAiCompatible } from "./probe";
import type { DriverDefinition } from "./types";

const DEFAULT_BASE = "https://api.x.ai/v1";

export const GROK_DEFAULT_VISION_MODEL = "grok-2-vision-1212";

export const grokDriver: DriverDefinition = {
	kind: "grok",
	label: "Grok",
	description: "xAI Grok via @ai-sdk/xai (API key). Vision-capable for test runs.",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["XAI_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true },
	async probe() {
		return {
			found: true,
			version: null,
			authenticated: null,
			detail: "API key provider — no CLI required",
			binaryPath: null,
		};
	},
	async validate(input) {
		const key = input.apiKey || input.env.XAI_API_KEY || null;
		if (!key) {
			return { ok: false, status: "invalid", message: "xAI API key is required (XAI_API_KEY)" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE).replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
			label: "Grok",
		});
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.XAI_API_KEY || null;
		if (!key) {
			return { models: [], message: "API key required to list Grok models" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE).replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
			label: "Grok",
		});
		return {
			models: (result.models ?? []).map((id) => ({ id, name: id })),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
