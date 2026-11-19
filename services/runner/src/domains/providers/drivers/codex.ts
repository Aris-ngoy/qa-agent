import { createOpenAI } from "@ai-sdk/openai";
import {
	AgentProviderError,
	createSdkVisionPort,
	resolveOpenAiCompatibleBaseUrl,
	resolveOpenAiCompatibleKey,
} from "../vision-model";
import { pingOpenAiCompatible, probeCli, runCommand } from "./probe";
import type { DriverDefinition, VisionAuth } from "./types";

const CODEX_DEFAULT_VISION = "gpt-5.1-codex";

/** The OpenAI model behind a Codex model id; the Codex default is not on the chat completions API. */
async function createCodexModel(auth: VisionAuth, modelId: string) {
	const apiKey = await resolveOpenAiCompatibleKey(auth);
	if (!apiKey) {
		throw new AgentProviderError(
			"Codex needs an OpenAI API key (paste in Settings) for vision runs and the Auto chat. Codex CLI OAuth via ai-sdk-provider-codex-cli requires Zod 4 and is not enabled yet.",
		);
	}
	const openaiModelId = modelId === CODEX_DEFAULT_VISION ? "gpt-4o" : modelId;
	return createOpenAI({
		apiKey,
		baseURL: resolveOpenAiCompatibleBaseUrl(auth),
		name: "codex",
	}).chat(openaiModelId);
}

export const codexDriver: DriverDefinition = {
	kind: "codex",
	label: "Codex",
	description:
		"Reuse Codex CLI login for Settings auth, or paste an OpenAI API key for vision runs.",
	defaultBinary: "codex",
	authModes: ["cli", "api_key"],
	envHints: ["OPENAI_API_KEY"],
	loginInstructions:
		"Run `codex login` (or `codex auth login`) in a terminal, then re-check. Or paste an OpenAI API key.",
	// The Codex CLI login cannot run the Auto chat yet; an OpenAI API key can.
	capabilities: { vision: true, chat: ["api_key"] },
	vision: createSdkVisionPort({
		label: "Codex",
		defaultModel: CODEX_DEFAULT_VISION,
		createModel: createCodexModel,
	}),
	chat: {
		defaultModel: "gpt-4o",
		missingCredential: async (auth) =>
			(await resolveOpenAiCompatibleKey(auth)) ? null : "It has no OpenAI API key.",
		createModel: createCodexModel,
	},
	async probe(binaryPath) {
		return probeCli({
			defaultBinary: "codex",
			binaryPath,
			authCheck: async (binary) => {
				for (const args of [["login", "status"], ["auth", "status"], ["status"]]) {
					const result = await runCommand([binary, ...args]);
					const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
					if (result.exitCode === 0) {
						if (
							text.includes("not logged") ||
							text.includes("unauthenticated") ||
							text.includes("not authenticated")
						) {
							continue;
						}
						return { authenticated: true, detail: "Authenticated via Codex CLI" };
					}
				}
				return {
					authenticated: false,
					detail: "`codex` found but auth status is unknown — run `codex login`",
				};
			},
		});
	},
	async validate(input) {
		const key = input.apiKey || input.env.OPENAI_API_KEY || null;
		if (key) {
			const base = (input.baseUrl?.replace(/\/$/, "") || "https://api.openai.com").replace(
				/\/$/,
				"",
			);
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
		}
		const probe = await this.probe(input.binaryPath);
		if (!probe.found) {
			return { ok: false, status: "not_found", message: probe.detail };
		}
		if (probe.authenticated) {
			return { ok: true, status: "connected", message: probe.detail };
		}
		return {
			ok: false,
			status: "invalid",
			message: probe.detail || "Codex CLI is not authenticated",
		};
	},
	async listModels(input) {
		const key = input.apiKey || input.env.OPENAI_API_KEY || null;
		if (key) {
			const base = (input.baseUrl?.replace(/\/$/, "") || "https://api.openai.com").replace(
				/\/$/,
				"",
			);
			const result = await pingOpenAiCompatible({
				apiKey: key,
				baseUrl: `${base}/v1`,
				label: "OpenAI",
			});
			return {
				models: (result.models ?? []).map((id) => ({ id, name: id })),
				message: result.ok ? `${result.models?.length ?? 0} models available` : result.message,
			};
		}
		return {
			models: [],
			message: "Model catalog requires an API key; CLI auth reuses your Codex login",
		};
	},
};
