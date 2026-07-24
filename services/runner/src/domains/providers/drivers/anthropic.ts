import { pingAnthropic } from "./probe";
import type { DriverDefinition } from "./types";

export const anthropicDriver: DriverDefinition = {
	kind: "anthropic",
	label: "Anthropic",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["ANTHROPIC_API_KEY"],
	loginInstructions: null,
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
