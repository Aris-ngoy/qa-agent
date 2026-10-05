import { createGroq } from "@ai-sdk/groq";
import {
	AgentProviderError,
	createSdkVisionPort,
	resolveGroqKey,
	withGroqRequestHooks,
} from "../vision-model";
import { pingOpenAiCompatible } from "./probe";
import type { DriverDefinition } from "./types";

const DEFAULT_BASE = "https://api.groq.com/openai/v1";

/** Current Groq vision model (Llama 4 Scout shut down 2026-07-17). */
export const GROQ_DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

/** Groq model families known to accept screenshots. */
const GROQ_VISION_MODEL_RE = /llama-4-(scout|maverick)|qwen\/qwen3\.[6-9]/i;
/** Groq model families known to be text-only (a blind agent footgun — see #141). */
const GROQ_TEXT_ONLY_MODEL_RE =
	/^(qwen|deepseek|llama-3|gemma|mixtral|whisper|openai\/gpt-oss|compound-beta|kimi)/i;

/** Tri-state vision capability for a model id: true / false / undefined (unknown). */
export function groqModelVision(modelId: string): boolean | undefined {
	const id = modelId.trim();
	if (!id) return undefined;
	if (GROQ_VISION_MODEL_RE.test(id)) return true;
	if (GROQ_TEXT_ONLY_MODEL_RE.test(id)) return false;
	return undefined;
}

export const groqDriver: DriverDefinition = {
	kind: "groq",
	label: "Groq",
	description: "Groq API via @ai-sdk/groq (Qwen 3.8 vision; Llama 4 Scout is shut down).",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["GROQ_API_KEY"],
	loginInstructions: null,
	capabilities: { vision: true },
	vision: createSdkVisionPort({
		label: "Groq",
		defaultModel: GROQ_DEFAULT_VISION_MODEL,
		// Decide output is one small JSON Action; a runaway thinking trace should
		// fail fast instead of burning the full budget (see #141).
		maxOutputTokens: 2048,
		createModel: (auth, modelId) => {
			const apiKey = resolveGroqKey(auth);
			if (!apiKey) {
				throw new AgentProviderError("Groq provider has no API key");
			}
			if (groqModelVision(modelId) === false) {
				throw new AgentProviderError(
					`This Groq model (${modelId}) cannot read screenshots (text-only). In Settings → Provider, set the default model to ${GROQ_DEFAULT_VISION_MODEL}.`,
				);
			}
			const baseURL = auth.baseUrl?.trim().replace(/\/$/, "") || DEFAULT_BASE;
			return createGroq({ apiKey, baseURL, fetch: withGroqRequestHooks({}) })(modelId);
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
			models: (result.models ?? []).map((id) => {
				const vision = groqModelVision(id);
				return { id, name: id, ...(vision === undefined ? {} : { vision }) };
			}),
			message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
		};
	},
};
