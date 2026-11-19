import { createAnthropic } from "@ai-sdk/anthropic";
import { AgentProviderError, createSdkVisionPort, resolveAnthropicKey } from "../vision-model";
import { pingAnthropic } from "./probe";
import type { DriverDefinition, VisionAuth } from "./types";

function createAnthropicModel(auth: VisionAuth, modelId: string) {
	const apiKey = resolveAnthropicKey(auth);
	if (!apiKey) {
		throw new AgentProviderError("Anthropic provider has no API key");
	}
	const rawBase = (auth.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
	const baseURL = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
	return createAnthropic({ apiKey, baseURL }).chat(modelId);
}

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514";

export const anthropicDriver: DriverDefinition = {
	kind: "anthropic",
	label: "Anthropic",
	description: "Direct Anthropic API access with usage-based billing.",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["ANTHROPIC_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true, chat: ["api_key"] },
	vision: createSdkVisionPort({
		label: "Anthropic",
		defaultModel: ANTHROPIC_DEFAULT_MODEL,
		createModel: createAnthropicModel,
	}),
	chat: {
		defaultModel: ANTHROPIC_DEFAULT_MODEL,
		missingCredential: (auth) => (resolveAnthropicKey(auth) ? null : "It has no API key."),
		createModel: createAnthropicModel,
	},
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
		const key = input.apiKey || input.env.ANTHROPIC_API_KEY || null;
		if (!key) {
			return { ok: false, status: "invalid", message: "Anthropic API key is required" };
		}
		const result = await pingAnthropic({ apiKey: key, baseUrl: input.baseUrl });
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.ANTHROPIC_API_KEY || null;
		if (!key) {
			return { models: [], message: "API key required to list models" };
		}
		const result = await pingAnthropic({ apiKey: key, baseUrl: input.baseUrl });
		return {
			models: (result.models ?? []).map((id) => ({ id, name: id })),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
