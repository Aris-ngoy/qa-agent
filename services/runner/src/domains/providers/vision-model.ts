import { homedir } from "node:os";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { ActiveProviderAuth } from "./application";
import { ANTIGRAVITY_DEFAULT_VISION_MODEL } from "./drivers/antigravity";
import { CURSOR_DEFAULT_VISION_MODEL } from "./drivers/cursor";
import { GROK_DEFAULT_VISION_MODEL } from "./drivers/grok";
import { OPENCODE_DEFAULT_VISION_MODEL } from "./drivers/opencode";

export {
	OPENCODE_DEFAULT_VISION_MODEL,
	ANTIGRAVITY_DEFAULT_VISION_MODEL,
	GROK_DEFAULT_VISION_MODEL,
	CURSOR_DEFAULT_VISION_MODEL,
};

const VISION_KINDS = new Set([
	"anthropic",
	"openai",
	"opencode",
	"codex",
	"groq",
	"google",
	"google-vertex",
	"antigravity",
	"grok",
	"custom",
	"cursor",
]);

export type VisionProviderKind =
	| "anthropic"
	| "openai"
	| "opencode"
	| "codex"
	| "groq"
	| "google"
	| "google-vertex"
	| "antigravity"
	| "grok"
	| "custom"
	| "cursor";
export type VisionModelBundle = {
	model: LanguageModel;
	label: string;
	kind: VisionProviderKind;
	modelId: string;
};

export class AgentProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentProviderError";
	}
}

const GROQ_DEFAULT_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
const GOOGLE_DEFAULT_VISION = "gemini-2.5-flash";
const CODEX_DEFAULT_VISION = "gpt-5.1-codex";

export function defaultVisionModelId(auth: ActiveProviderAuth): string {
	if (auth.defaultModel?.trim()) return auth.defaultModel.trim();
	if (auth.kind === "anthropic") return "claude-sonnet-4-20250514";
	if (auth.kind === "opencode") return OPENCODE_DEFAULT_VISION_MODEL;
	if (auth.kind === "groq") return GROQ_DEFAULT_VISION;
	if (auth.kind === "grok") return GROK_DEFAULT_VISION_MODEL;
	if (auth.kind === "cursor") return CURSOR_DEFAULT_VISION_MODEL;
	if (auth.kind === "custom") return "";
	if (auth.kind === "google" || auth.kind === "google-vertex" || auth.kind === "antigravity") {
		return auth.kind === "antigravity" ? ANTIGRAVITY_DEFAULT_VISION_MODEL : GOOGLE_DEFAULT_VISION;
	}
	if (auth.kind === "codex") return CODEX_DEFAULT_VISION;
	return "gpt-4o";
}

export function resolveAnthropicKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.ANTHROPIC_API_KEY?.trim() ||
		process.env.ANTHROPIC_API_KEY?.trim() ||
		null
	);
}

function openCodeAuthPaths(): string[] {
	const paths: string[] = [];
	const xdg = process.env.XDG_DATA_HOME?.trim();
	if (xdg) paths.push(join(xdg, "opencode", "auth.json"));
	paths.push(join(homedir(), ".local", "share", "opencode", "auth.json"));
	return paths;
}

async function readOpenCodeCliAuthKey(): Promise<string | null> {
	for (const path of openCodeAuthPaths()) {
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) continue;
			const json: unknown = await file.json();
			if (!json || typeof json !== "object") continue;
			const opencode = (json as Record<string, unknown>).opencode;
			if (
				opencode &&
				typeof opencode === "object" &&
				"key" in opencode &&
				typeof (opencode as { key: unknown }).key === "string"
			) {
				const key = (opencode as { key: string }).key.trim();
				if (key) return key;
			}
		} catch {
			// Try next path.
		}
	}
	return null;
}

export async function resolveOpenAiCompatibleKey(auth: ActiveProviderAuth): Promise<string | null> {
	if (auth.apiKey?.trim()) return auth.apiKey.trim();
	if (auth.kind === "opencode") {
		return (
			auth.env.OPENCODE_API_KEY?.trim() ||
			auth.env.OPENCODE_ZEN_API_KEY?.trim() ||
			process.env.OPENCODE_API_KEY?.trim() ||
			process.env.OPENCODE_ZEN_API_KEY?.trim() ||
			(await readOpenCodeCliAuthKey())
		);
	}
	return auth.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function resolveOpenAiCompatibleBaseUrl(auth: ActiveProviderAuth): string {
	if (auth.baseUrl?.trim()) {
		return auth.baseUrl.replace(/\/$/, "");
	}
	if (auth.kind === "opencode") {
		if (auth.serverUrl?.trim()) {
			return `${auth.serverUrl.replace(/\/$/, "")}/v1`;
		}
		return "https://opencode.ai/zen/v1";
	}
	if (auth.kind === "groq") {
		return "https://api.groq.com/openai/v1";
	}
	if (auth.kind === "grok") {
		return "https://api.x.ai/v1";
	}
	return "https://api.openai.com/v1";
}

function resolveGroqKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() || auth.env.GROQ_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim() || null
	);
}

function resolveGrokKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() || auth.env.XAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || null
	);
}

function resolveCustomKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.OPENAI_API_KEY?.trim() ||
		process.env.OPENAI_API_KEY?.trim() ||
		null
	);
}

export function resolveGoogleKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
		auth.env.GOOGLE_API_KEY?.trim() ||
		process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
		process.env.GOOGLE_API_KEY?.trim() ||
		null
	);
}

function resolveVertexApiKey(auth: ActiveProviderAuth): string | null {
	return (
		auth.apiKey?.trim() ||
		auth.env.GOOGLE_VERTEX_API_KEY?.trim() ||
		process.env.GOOGLE_VERTEX_API_KEY?.trim() ||
		null
	);
}

export function formatProviderHttpError(label: string, status: number, body: string): string {
	if (label === "OpenCode" && body.includes("CreditsError")) {
		return `OpenCode Zen needs billing for this model, or pick a free model in Settings → Provider. Add a payment method at opencode.ai, or switch to a Free vision model (e.g. ${OPENCODE_DEFAULT_VISION_MODEL}).`;
	}
	if (
		label === "OpenCode" &&
		status >= 500 &&
		(body.includes("Internal server error") || body.includes('"type":"error"'))
	) {
		return `OpenCode Zen returned an internal error for this vision request. Many free models (including north-mini-code-free and big-pickle) reject screenshots with opaque 500s. In Settings → Provider, set the default model to ${OPENCODE_DEFAULT_VISION_MODEL} (or another vision-capable model).`;
	}
	return `${label} request failed (${status}): ${body.slice(0, 400)}`;
}

/**
 * DeepSeek-style OpenCode models burn tokens on reasoning unless thinking is off.
 * Inject into chat/completions JSON bodies via a custom fetch wrapper.
 */
function withOpenCodeThinkingDisabled(fetchImpl: FetchFunction = globalThis.fetch): FetchFunction {
	return (async (input, init) => {
		if (!init?.body || typeof init.body !== "string") {
			return fetchImpl(input, init);
		}
		try {
			const parsed: unknown = JSON.parse(init.body);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return fetchImpl(input, init);
			}
			const body = {
				...(parsed as Record<string, unknown>),
				thinking: { type: "disabled" },
			};
			return fetchImpl(input, {
				...init,
				body: JSON.stringify(body),
			});
		} catch {
			return fetchImpl(input, init);
		}
	}) as FetchFunction;
}

async function hasVisionAuth(auth: ActiveProviderAuth): Promise<boolean> {
	switch (auth.kind) {
		case "anthropic":
			return Boolean(resolveAnthropicKey(auth));
		case "openai":
		case "opencode":
			return Boolean(await resolveOpenAiCompatibleKey(auth));
		case "groq":
			return Boolean(resolveGroqKey(auth));
		case "grok":
			return Boolean(resolveGrokKey(auth));
		case "custom":
			return Boolean(auth.baseUrl?.trim()) && Boolean(auth.defaultModel?.trim());
		case "google":
			return Boolean(resolveGoogleKey(auth));
		case "antigravity":
			// CLI (`agy`) or Google AI Studio key fallback
			return Boolean(resolveGoogleKey(auth)) || auth.authMode === "cli";
		case "google-vertex":
			return Boolean(
				resolveVertexApiKey(auth) ||
					auth.env.GOOGLE_VERTEX_PROJECT?.trim() ||
					process.env.GOOGLE_VERTEX_PROJECT?.trim(),
			);
		case "codex":
			// CLI OAuth package (ai-sdk-provider-codex-cli) needs Zod 4; we stay on Zod 3.
			return Boolean(await resolveOpenAiCompatibleKey(auth));
		case "cursor":
			return (
				Boolean(auth.apiKey?.trim()) ||
				Boolean(auth.env.CURSOR_API_KEY?.trim()) ||
				Boolean(process.env.CURSOR_API_KEY?.trim()) ||
				auth.authMode === "cli"
			);
		default:
			return false;
	}
}

export async function assertVisionCapableProvider(
	auth: ActiveProviderAuth | null,
): Promise<ActiveProviderAuth> {
	if (!auth) {
		throw new AgentProviderError(
			"No enabled AI provider configured. Add a vision-capable provider in Settings (Anthropic, OpenAI, OpenCode, Codex, Groq, Grok, Google, Vertex, Antigravity, Cursor, or Custom).",
		);
	}
	if (!VISION_KINDS.has(auth.kind)) {
		throw new AgentProviderError(
			`Provider kind "${auth.kind}" does not support vision runs yet. Configure Anthropic, OpenAI, OpenCode, Codex, Groq, Grok, Google, Vertex, Antigravity, Cursor, or Custom.`,
		);
	}
	if (!(await hasVisionAuth(auth))) {
		const hint =
			auth.kind === "opencode"
				? " Add an API key in Settings, set OPENCODE_API_KEY, or run `opencode providers login`."
				: auth.kind === "codex"
					? " Paste an OpenAI API key in Settings (Codex CLI OAuth vision needs Zod 4)."
					: auth.kind === "antigravity"
						? " Install `agy` and sign in via Antigravity, or paste a Google AI Studio API key."
						: auth.kind === "google-vertex"
							? " Set a Vertex API key or GOOGLE_VERTEX_PROJECT."
							: auth.kind === "grok"
								? " Paste an xAI API key (XAI_API_KEY)."
								: auth.kind === "cursor"
									? " Run `cursor-agent login` or paste a CURSOR_API_KEY in Settings."
									: auth.kind === "custom"
										? " Set Base URL and a default model in Settings."
										: "";
		throw new AgentProviderError(
			`Provider "${auth.kind}" is not authenticated for vision runs.${hint}`,
		);
	}
	return auth;
}

export async function createVisionModel(auth: ActiveProviderAuth): Promise<VisionModelBundle> {
	const modelId = defaultVisionModelId(auth);

	if (auth.kind === "anthropic") {
		const apiKey = resolveAnthropicKey(auth);
		if (!apiKey) {
			throw new AgentProviderError("Anthropic provider has no API key");
		}
		const rawBase = (auth.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
		const baseURL = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
		const provider = createAnthropic({
			apiKey,
			baseURL,
		});
		return {
			model: provider.chat(modelId),
			label: "Anthropic",
			kind: "anthropic",
			modelId,
		};
	}

	if (auth.kind === "openai" || auth.kind === "opencode") {
		const apiKey = await resolveOpenAiCompatibleKey(auth);
		const label = auth.kind === "opencode" ? "OpenCode" : "OpenAI";
		if (!apiKey) {
			throw new AgentProviderError(`${label} provider has no API key`);
		}
		const baseURL = resolveOpenAiCompatibleBaseUrl(auth);
		const provider = createOpenAI({
			apiKey,
			baseURL,
			name: auth.kind,
			...(auth.kind === "opencode" ? { fetch: withOpenCodeThinkingDisabled() } : {}),
		});
		return {
			model: provider.chat(modelId),
			label,
			kind: auth.kind,
			modelId,
		};
	}

	if (auth.kind === "groq") {
		const apiKey = resolveGroqKey(auth);
		if (!apiKey) {
			throw new AgentProviderError("Groq provider has no API key");
		}
		const baseURL = resolveOpenAiCompatibleBaseUrl(auth);
		const provider = createGroq({ apiKey, baseURL });
		return {
			model: provider(modelId),
			label: "Groq",
			kind: "groq",
			modelId,
		};
	}

	if (auth.kind === "google") {
		const apiKey = resolveGoogleKey(auth);
		if (!apiKey) {
			throw new AgentProviderError("Google provider has no API key");
		}
		const provider = createGoogleGenerativeAI({ apiKey });
		return {
			model: provider(modelId),
			label: "Google",
			kind: "google",
			modelId,
		};
	}

	if (auth.kind === "antigravity") {
		const apiKey = resolveGoogleKey(auth);
		if (!apiKey) {
			throw new AgentProviderError(
				"Antigravity without an API key uses the `agy` CLI path — call decideWithAntigravityCli instead.",
			);
		}
		// Google AI Studio key fallback — agy model slugs often differ from Generative Language IDs
		const googleModelId =
			modelId.startsWith("gemini-1.") || modelId.startsWith("gemini-2.")
				? modelId
				: "gemini-2.5-flash";
		const provider = createGoogleGenerativeAI({ apiKey });
		return {
			model: provider(googleModelId),
			label: "Antigravity",
			kind: "antigravity",
			modelId: googleModelId,
		};
	}

	if (auth.kind === "google-vertex") {
		const apiKey = resolveVertexApiKey(auth);
		const project =
			auth.env.GOOGLE_VERTEX_PROJECT?.trim() ||
			process.env.GOOGLE_VERTEX_PROJECT?.trim() ||
			undefined;
		const location =
			auth.env.GOOGLE_VERTEX_LOCATION?.trim() ||
			process.env.GOOGLE_VERTEX_LOCATION?.trim() ||
			"us-central1";
		if (!apiKey && !project) {
			throw new AgentProviderError("Google Vertex needs an API key or GOOGLE_VERTEX_PROJECT");
		}
		const provider = createVertex({
			...(apiKey ? { apiKey } : {}),
			...(project ? { project } : {}),
			location,
			...(auth.baseUrl?.trim() ? { baseURL: auth.baseUrl.replace(/\/$/, "") } : {}),
		});
		return {
			model: provider(modelId),
			label: "Google Vertex",
			kind: "google-vertex",
			modelId,
		};
	}

	if (auth.kind === "codex") {
		const apiKey = await resolveOpenAiCompatibleKey(auth);
		if (!apiKey) {
			throw new AgentProviderError(
				"Codex vision runs need an OpenAI API key (paste in Settings). Codex CLI OAuth via ai-sdk-provider-codex-cli requires Zod 4 and is not enabled yet.",
			);
		}
		const baseURL = resolveOpenAiCompatibleBaseUrl(auth);
		const openaiModelId = modelId === CODEX_DEFAULT_VISION ? "gpt-4o" : modelId;
		const provider = createOpenAI({
			apiKey,
			baseURL,
			name: "codex",
		});
		return {
			model: provider.chat(openaiModelId),
			label: "Codex",
			kind: "codex",
			modelId: openaiModelId,
		};
	}

	if (auth.kind === "grok") {
		const apiKey = resolveGrokKey(auth);
		if (!apiKey) {
			throw new AgentProviderError("Grok provider has no xAI API key");
		}
		const baseURL = resolveOpenAiCompatibleBaseUrl(auth);
		const provider = createXai({ apiKey, baseURL });
		return {
			model: provider(modelId),
			label: "Grok",
			kind: "grok",
			modelId,
		};
	}

	if (auth.kind === "custom") {
		const baseURL = auth.baseUrl?.trim().replace(/\/$/, "") || null;
		if (!baseURL) {
			throw new AgentProviderError("Custom provider needs a Base URL in Settings");
		}
		if (!modelId.trim()) {
			throw new AgentProviderError(
				"Custom provider needs a default model in Settings before vision runs",
			);
		}
		const apiKey = resolveCustomKey(auth) || "no-key";
		const provider = createOpenAI({
			apiKey,
			baseURL,
			name: "custom",
		});
		return {
			model: provider.chat(modelId),
			label: "Custom",
			kind: "custom",
			modelId,
		};
	}

	if (auth.kind === "cursor") {
		throw new AgentProviderError(
			"Cursor vision uses the Agent CLI path — call decideWithCursorCli / groundWithCursorCli instead of createVisionModel.",
		);
	}

	throw new AgentProviderError(`Provider kind "${auth.kind}" does not support vision runs yet.`);
}
