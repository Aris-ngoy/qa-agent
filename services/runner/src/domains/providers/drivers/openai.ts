import { createOpenAI } from "@ai-sdk/openai";
import {
	AgentProviderError,
	createSdkVisionPort,
	resolveOpenAiCompatibleBaseUrl,
	resolveOpenAiCompatibleKey,
} from "../vision-model";
import { pingOpenAiCompatible } from "./probe";
import type { DriverDefinition } from "./types";

export const openaiDriver: DriverDefinition = {
	kind: "openai",
	label: "OpenAI",
	description: "Direct OpenAI API access with usage-based billing.",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["OPENAI_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "OpenAI",
		defaultModel: "gpt-4o",
		createModel: async (auth, modelId) => {
			const apiKey = await resolveOpenAiCompatibleKey(auth);
			if (!apiKey) {
				throw new AgentProviderError("OpenAI provider has no API key");
			}
			return createOpenAI({
				apiKey,
				baseURL: resolveOpenAiCompatibleBaseUrl(auth),
				name: "openai",
			}).chat(modelId);
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
		const key = input.apiKey || input.env.OPENAI_API_KEY || null;
		if (!key) {
			return { ok: false, status: "invalid", message: "OpenAI API key is required" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || "https://api.openai.com").replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: `${base}/v1`,
			label: "OpenAI",
		});
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.OPENAI_API_KEY || null;
		if (!key) {
			return { models: [], message: "API key required to list models" };
		}
		const base = (input.baseUrl?.replace(/\/$/, "") || "https://api.openai.com").replace(/\/$/, "");
		const result = await pingOpenAiCompatible({
			apiKey: key,
			baseUrl: `${base}/v1`,
			label: "OpenAI",
		});
		return {
			models: (result.models ?? []).map((id) => ({ id, name: id })),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
