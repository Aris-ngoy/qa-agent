import { getRunnerClient } from "@/app/runner-client";
import { useQuery } from "@tanstack/react-query";
import type {
	ProviderAccentColor,
	ProviderAuthMode,
	ProviderDriverCatalogEntry,
	ProviderKind,
} from "@yoqa/runner-client";
import type { ReactNode } from "react";
import {
	AcpLogo,
	AnthropicLogo,
	ClaudeLogo,
	CodexLogo,
	CursorLogo,
	FallbackLogo,
	GeminiLogo,
	GitHubCopilotLogo,
	GrokLogo,
	GroqLogo,
	OpenAiLogo,
	OpenCodeLogo,
	PiLogo,
} from "./provider-logos";

export type DriverMeta = {
	kind: ProviderKind | "acp" | "pi";
	label: string;
	description: string;
	authModes: ProviderAuthMode[];
	defaultBinary: string | null;
	envHints: string[];
	keyPlaceholder: string;
	comingSoon?: boolean;
	earlyAccess?: boolean;
	loginInstructions: string | null;
	capabilities?: { vision: boolean };
};

/**
 * Local fallback catalog when the runner is unreachable.
 * Product facts (label, authModes, capabilities) prefer GET /providers/catalog.
 * keyPlaceholder + logos stay desktop-owned.
 */
export const FALLBACK_ACTIVE_DRIVERS: DriverMeta[] = [
	{
		kind: "anthropic",
		label: "Anthropic",
		description: "Direct Anthropic API access with usage-based billing.",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["ANTHROPIC_API_KEY"],
		keyPlaceholder: "sk-ant-…",
		loginInstructions: null,
		capabilities: { vision: true },
	},
	{
		kind: "openai",
		label: "OpenAI",
		description: "Direct OpenAI API access with usage-based billing.",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["OPENAI_API_KEY"],
		keyPlaceholder: "sk-…",
		loginInstructions: null,
		capabilities: { vision: true },
	},
	{
		kind: "claude",
		label: "Claude",
		description: "Reuse Claude Code CLI login or paste an Anthropic API key.",
		authModes: ["cli", "api_key"],
		defaultBinary: "claude",
		envHints: ["ANTHROPIC_API_KEY"],
		keyPlaceholder: "sk-ant-…",
		loginInstructions: "Run `claude auth login` in a terminal, then re-check.",
		capabilities: { vision: false },
	},
	{
		kind: "codex",
		label: "Codex",
		description:
			"Reuse Codex CLI login for Settings auth, or paste an OpenAI API key for vision runs.",
		authModes: ["cli", "api_key"],
		defaultBinary: "codex",
		envHints: ["OPENAI_API_KEY"],
		keyPlaceholder: "sk-…",
		loginInstructions: "Run `codex login` in a terminal, then re-check.",
		capabilities: { vision: true },
	},
	{
		kind: "opencode",
		label: "OpenCode",
		description:
			"OpenCode Zen or LiteLLM (OpenAI-compatible). Paste a Zen API key for Zen; LiteLLM uses opencode.json.",
		authModes: ["cli", "api_key"],
		defaultBinary: "opencode",
		envHints: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY", "LITELLM_API_KEY"],
		keyPlaceholder: "sk-…",
		loginInstructions:
			"Paste a Zen API key from https://opencode.ai for Zen vision. LiteLLM uses opencode.json plus CLI auth or LITELLM_API_KEY. CLI login alone is not enough for Zen (local serve has no OpenAI /v1).",
		capabilities: { vision: true },
	},
	{
		kind: "github-copilot",
		label: "GitHub Copilot",
		description: "Authenticate with a GitHub token that has Copilot access.",
		authModes: ["token"],
		defaultBinary: null,
		envHints: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN"],
		keyPlaceholder: "ghp_… / gho_…",
		loginInstructions: "Paste COPILOT_GITHUB_TOKEN / GH_TOKEN. Device login requires a terminal.",
		capabilities: { vision: false },
	},
	{
		kind: "groq",
		label: "Groq",
		description: "Groq API via @ai-sdk/groq (fast Llama / vision-capable scout models).",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["GROQ_API_KEY"],
		keyPlaceholder: "gsk_…",
		loginInstructions: null,
		capabilities: { vision: true },
	},
	{
		kind: "google",
		label: "Google",
		description: "Google Generative AI (Gemini) via @ai-sdk/google.",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
		keyPlaceholder: "AIza…",
		loginInstructions: null,
		capabilities: { vision: true },
	},
	{
		kind: "google-vertex",
		label: "Google Vertex",
		description: "Vertex AI Gemini via @ai-sdk/google-vertex (express API key or GCP project).",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: [
			"GOOGLE_VERTEX_API_KEY",
			"GOOGLE_VERTEX_PROJECT",
			"GOOGLE_VERTEX_LOCATION",
			"GOOGLE_APPLICATION_CREDENTIALS",
		],
		keyPlaceholder: "Vertex API key…",
		loginInstructions:
			"Paste express-mode API key, or set GOOGLE_VERTEX_PROJECT / LOCATION env in Advanced.",
		capabilities: { vision: true },
	},
	{
		kind: "antigravity",
		label: "Antigravity",
		description:
			"Google Antigravity CLI (`agy`). Lists models via `agy models`; vision uses `agy --print` or a Google AI Studio API key fallback.",
		authModes: ["cli", "api_key"],
		defaultBinary: "agy",
		envHints: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
		keyPlaceholder: "AIza…",
		loginInstructions:
			"Install `agy` and sign in via Antigravity. If eligibility fails, paste a Google AI Studio API key (or use the Google provider).",
		capabilities: { vision: true },
	},
	{
		kind: "cursor",
		label: "Cursor",
		description:
			"Reuse Cursor Agent CLI login (`cursor-agent`) or paste a CURSOR_API_KEY. Vision runs use `cursor-agent --print` in ask mode.",
		authModes: ["cli", "api_key"],
		defaultBinary: "cursor-agent",
		envHints: ["CURSOR_API_KEY"],
		keyPlaceholder: "key_…",
		loginInstructions: "Run `cursor-agent login` (or `cursor agent login`), then re-check.",
		capabilities: { vision: true },
	},
	{
		kind: "grok",
		label: "Grok",
		description: "xAI Grok via @ai-sdk/xai (API key). Vision-capable for test runs.",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["XAI_API_KEY"],
		keyPlaceholder: "xai-…",
		loginInstructions: null,
		capabilities: { vision: true },
	},
	{
		kind: "custom",
		label: "Custom",
		description:
			"Any OpenAI-compatible endpoint (Ollama, LM Studio, gateway). Requires Base URL; API key optional for local hosts.",
		authModes: ["api_key"],
		defaultBinary: null,
		envHints: ["OPENAI_API_KEY"],
		keyPlaceholder: "optional…",
		loginInstructions:
			"Set Base URL to an OpenAI-compatible /v1 root (e.g. http://127.0.0.1:11434/v1).",
		capabilities: { vision: true },
	},
];

/** @deprecated Prefer useActiveDrivers() — kept as alias of the local fallback. */
export const ACTIVE_DRIVERS: DriverMeta[] = FALLBACK_ACTIVE_DRIVERS;

export const COMING_SOON_DRIVERS: DriverMeta[] = [
	{
		kind: "acp",
		label: "ACP Registry",
		description: "Coming soon",
		authModes: ["cli"],
		defaultBinary: null,
		envHints: [],
		keyPlaceholder: "",
		comingSoon: true,
		loginInstructions: null,
	},
	{
		kind: "pi",
		label: "Pi Agent",
		description: "Coming soon",
		authModes: ["cli"],
		defaultBinary: null,
		envHints: [],
		keyPlaceholder: "",
		comingSoon: true,
		loginInstructions: null,
	},
];

export const PROVIDERS_QUERY_KEY = ["ai-providers"] as const;
export const PROVIDER_CATALOG_QUERY_KEY = [...PROVIDERS_QUERY_KEY, "catalog"] as const;

export function mergeCatalogWithLocal(
	catalog: ProviderDriverCatalogEntry[] | null | undefined,
): DriverMeta[] {
	if (!catalog?.length) return FALLBACK_ACTIVE_DRIVERS;
	return catalog.map((entry) => {
		const local = FALLBACK_ACTIVE_DRIVERS.find((d) => d.kind === entry.kind);
		return {
			kind: entry.kind,
			label: entry.label,
			description: entry.description ?? local?.description ?? "",
			authModes: entry.authModes,
			defaultBinary: entry.defaultBinary,
			envHints: entry.envHints,
			keyPlaceholder: local?.keyPlaceholder ?? "",
			loginInstructions: entry.loginInstructions,
			capabilities: entry.capabilities,
		};
	});
}

export function useProviderDriverCatalog(enabled = true) {
	return useQuery({
		queryKey: PROVIDER_CATALOG_QUERY_KEY,
		enabled,
		queryFn: async () => {
			const client = await getRunnerClient();
			return client.listProviderCatalog();
		},
		staleTime: 60_000,
	});
}

/** Active drivers with runner catalog preferred when available. */
export function useActiveDrivers(enabled = true): DriverMeta[] {
	const catalogQuery = useProviderDriverCatalog(enabled);
	return mergeCatalogWithLocal(catalogQuery.data);
}

export function useDriverCards(enabled = true): DriverMeta[] {
	const active = useActiveDrivers(enabled);
	return [...active, ...COMING_SOON_DRIVERS];
}

export const ALL_DRIVER_CARDS: DriverMeta[] = [...ACTIVE_DRIVERS, ...COMING_SOON_DRIVERS];

export const ACCENT_COLORS: { id: ProviderAccentColor; className: string }[] = [
	{ id: "blue", className: "bg-blue-500" },
	{ id: "royal", className: "bg-indigo-500" },
	{ id: "green", className: "bg-emerald-500" },
	{ id: "orange", className: "bg-orange-500" },
	{ id: "red", className: "bg-red-500" },
	{ id: "purple", className: "bg-violet-500" },
	{ id: "cyan", className: "bg-cyan-500" },
];

export function getDriverMeta(
	kind: ProviderKind,
	catalog?: ProviderDriverCatalogEntry[] | null,
): DriverMeta {
	const found = mergeCatalogWithLocal(catalog).find((d) => d.kind === kind);
	if (!found) {
		return {
			kind,
			label: kind,
			description: "",
			authModes: ["api_key"],
			defaultBinary: null,
			envHints: [],
			keyPlaceholder: "",
			loginInstructions: null,
		};
	}
	return found;
}

export function useDriverMeta(kind: ProviderKind, enabled = true): DriverMeta {
	const catalogQuery = useProviderDriverCatalog(enabled);
	return getDriverMeta(kind, catalogQuery.data);
}

export function statusDotClass(status: string): string {
	switch (status) {
		case "connected":
			return "bg-emerald-500";
		case "disabled":
			return "bg-amber-400";
		case "not_found":
		case "invalid":
			return "bg-red-500";
		default:
			return "bg-zinc-500";
	}
}

export function DriverGlyph({ kind }: { kind: string }): ReactNode {
	const logo = (() => {
		switch (kind) {
			case "anthropic":
				return <AnthropicLogo />;
			case "openai":
				return <OpenAiLogo />;
			case "claude":
				return <ClaudeLogo />;
			case "codex":
				return <CodexLogo />;
			case "opencode":
				return <OpenCodeLogo />;
			case "github-copilot":
				return <GitHubCopilotLogo />;
			case "groq":
				return <GroqLogo />;
			case "google":
			case "google-vertex":
			case "antigravity":
				return <GeminiLogo />;
			case "cursor":
				return <CursorLogo />;
			case "grok":
				return <GrokLogo />;
			case "custom":
				return <FallbackLogo label="Custom" />;
			case "acp":
				return <AcpLogo />;
			case "pi":
				return <PiLogo />;
			default:
				return <FallbackLogo label={kind} />;
		}
	})();

	return (
		<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface">
			{logo}
		</span>
	);
}

export const fieldInputClass =
	"h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md shadow-none";
