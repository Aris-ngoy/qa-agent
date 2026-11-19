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
} from "@/features/providers/components/provider-logos";
import type { ReactNode } from "react";

/** A Provider kind's logo, bare (Settings frames it in `DriverGlyph`; the Auto picker does not). */
export function ProviderLogo({ kind }: { kind: string }): ReactNode {
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
}

export function DriverGlyph({ kind }: { kind: string }): ReactNode {
	const logo = <ProviderLogo kind={kind} />;

	return (
		<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface">
			{logo}
		</span>
	);
}
