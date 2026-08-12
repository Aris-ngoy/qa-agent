import type { ActiveProviderAuth } from "./application";
import { getDriver } from "./drivers";
import type { VisionCompleteInput, VisionPort } from "./drivers/types";
import { AgentProviderError } from "./vision-model";

export { AgentProviderError } from "./vision-model";

export function resolveVision(auth: ActiveProviderAuth): VisionPort {
	const vision = getDriver(auth.kind).vision;
	if (!vision) {
		throw new AgentProviderError(
			`Provider kind "${auth.kind}" does not support vision runs yet. Configure Anthropic, OpenAI, OpenCode, Codex, Groq, Grok, Google, Vertex, Antigravity, Cursor, or Custom.`,
		);
	}
	return vision;
}

export async function assertVisionCapableProvider(
	auth: ActiveProviderAuth | null,
): Promise<ActiveProviderAuth> {
	if (!auth) {
		throw new AgentProviderError(
			"No enabled AI provider configured. Add a vision-capable provider in Settings (Anthropic, OpenAI, OpenCode, Codex, Groq, Grok, Google, Vertex, Antigravity, Cursor, or Custom).",
		);
	}
	resolveVision(auth);
	return auth;
}

export async function completeVision<T>(
	auth: ActiveProviderAuth,
	input: Omit<VisionCompleteInput<T>, "auth">,
): Promise<T> {
	return resolveVision(auth).completeObject({ ...input, auth });
}
