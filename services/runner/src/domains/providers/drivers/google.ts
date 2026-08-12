import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AgentProviderError, createSdkVisionPort, resolveGoogleKey } from "../vision-model";
import type { DriverDefinition } from "./types";

const DEFAULT_MODELS = [
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.0-flash",
	"gemini-1.5-flash",
	"gemini-1.5-pro",
];

async function pingGoogleGenerativeAi(apiKey: string): Promise<{
	ok: boolean;
	message: string;
	models?: string[];
}> {
	try {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
		);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				message: detail
					? `Google AI validation failed (${response.status}): ${detail.slice(0, 200)}`
					: `Google AI validation failed: HTTP ${response.status}`,
			};
		}
		const json: unknown = await response.json().catch(() => null);
		const models: string[] = [];
		if (
			json &&
			typeof json === "object" &&
			"models" in json &&
			Array.isArray((json as { models: unknown }).models)
		) {
			for (const item of (json as { models: unknown[] }).models) {
				if (!item || typeof item !== "object" || !("name" in item)) continue;
				const name = (item as { name: unknown }).name;
				if (typeof name !== "string") continue;
				const id = name.replace(/^models\//, "");
				if (id) models.push(id);
			}
		}
		return {
			ok: true,
			message: "Google AI credentials are valid",
			models: models.length > 0 ? models : DEFAULT_MODELS,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Google AI validation request failed: ${message}` };
	}
}

export const googleDriver: DriverDefinition = {
	kind: "google",
	label: "Google",
	description: "Google Generative AI (Gemini) via @ai-sdk/google.",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "Google",
		defaultModel: "gemini-2.5-flash",
		createModel: (auth, modelId) => {
			const apiKey = resolveGoogleKey(auth);
			if (!apiKey) {
				throw new AgentProviderError("Google provider has no API key");
			}
			return createGoogleGenerativeAI({ apiKey })(modelId);
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
		const key =
			input.apiKey || input.env.GOOGLE_GENERATIVE_AI_API_KEY || input.env.GOOGLE_API_KEY || null;
		if (!key) {
			return {
				ok: false,
				status: "invalid",
				message: "Google Generative AI API key is required",
			};
		}
		const result = await pingGoogleGenerativeAi(key);
		return {
			ok: result.ok,
			status: result.ok ? "connected" : "invalid",
			message: result.message,
		};
	},
	async listModels(input) {
		const key =
			input.apiKey || input.env.GOOGLE_GENERATIVE_AI_API_KEY || input.env.GOOGLE_API_KEY || null;
		if (!key) {
			return { models: [], message: "API key required to list models" };
		}
		const result = await pingGoogleGenerativeAi(key);
		return {
			models: (result.models ?? DEFAULT_MODELS).map((id) => ({ id, name: id })),
			message: result.ok
				? `${result.models?.length ?? DEFAULT_MODELS.length} models available`
				: result.message,
		};
	},
};
