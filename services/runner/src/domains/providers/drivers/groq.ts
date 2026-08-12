import { createGroq } from "@ai-sdk/groq";
import { AgentProviderError, createSdkVisionPort, resolveGroqKey } from "../vision-model";
import { pingOpenAiCompatible } from "./probe";
import type { DriverDefinition } from "./types";

const DEFAULT_BASE = "https://api.groq.com/openai/v1";

export const groqDriver: DriverDefinition = {
	kind: "groq",
	label: "Groq",
	description: "Groq API via @ai-sdk/groq (fast Llama / vision-capable scout models).",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["GROQ_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "Groq",
		defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
		createModel: (auth, modelId) => {
			const apiKey = resolveGroqKey(auth);
			if (!apiKey) {
				throw new AgentProviderError("Groq provider has no API key");
			}
			const baseURL = auth.baseUrl?.trim().replace(/\/$/, "") || DEFAULT_BASE;
			return createGroq({ apiKey, baseURL })(modelId);
		},
	}),
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
		const key = input.apiKey || input.env.GROQ_API_KEY || null;
		if (!key) {
			return { ok: false, status: "invalid", message: "Groq API key is required" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE).replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
			label: "Groq",
		});
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.GROQ_API_KEY || null;
		if (!key) {
			return { models: [], message: "API key required to list models" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE).replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
			label: "Groq",
		});
		return {
			models: (result.models ?? []).map((id) => ({ id, name: id })),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
