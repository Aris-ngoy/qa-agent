import type {
	AutoModel,
	AutoStatus,
	ListAutoModelsResponse,
	ProviderKind,
} from "@yoqa/runner-client";
import type { LanguageModel } from "ai";
import {
	type ActiveProviderAuth,
	type ProviderAuthEntry,
	listProviderAuths,
} from "../providers/application";
import { getDriver } from "../providers/drivers";
import { AgentProviderError } from "../providers/vision-model";
import { type AiSdkChatTarget, createAiSdkChatAgent } from "./ai-sdk-agent";
import type { ChatAgent, ChatAgentEvent, ChatProvider, ChatTurn } from "./chat-agent";
import {
	claudeChatModels,
	claudeSignInProblem,
	createClaudeChatAgent,
	probeClaudeCli,
} from "./claude-agent";

/**
 * The production chat agent (ADR 0014): it reads which Providers can chat, and answers each
 * turn on the chat's own Provider, through the Claude Agent SDK for the Claude Provider and
 * the AI SDK chat agent for every other Chat-capable Provider. Never a fallback to another.
 */

export type RoutingChatAgentDeps = {
	/** Answers a turn on the Claude Provider. */
	claude?: { runTurn: (turn: ChatTurn, auth: ActiveProviderAuth) => AsyncIterable<ChatAgentEvent> };
	/** Answers a turn on any other Chat-capable Provider. */
	aiSdk?: { runTurn: (turn: ChatTurn, target: AiSdkChatTarget) => AsyncIterable<ChatAgentEvent> };
	/** Whether the Claude CLI login is signed in; `claude auth status` unless a test says. */
	probeClaudeCli?: (binaryPath: string | null) => Promise<{ signedIn: boolean; detail: string }>;
	/** A Provider's chat models; its driver's model listing unless a test says. */
	listModels?: (auth: ActiveProviderAuth) => Promise<AutoModel[]>;
};

/** The key a CLI-login Provider would chat with instead, as the picker names it. */
const API_KEY_INSTEAD: Partial<Record<ProviderKind, string>> = {
	codex: "an OpenAI API key",
	opencode: "an OpenCode Zen API key",
	antigravity: "a Google AI Studio API key",
};

/** Why a Provider of a kind that cannot chat in any mode yet cannot. */
const CANNOT_CHAT: Partial<Record<ProviderKind, string>> = {
	cursor: "even with an API key, Cursor runs through the cursor-agent CLI",
};

/** A Provider as the router knows it: what the chat sees, and its credentials. */
type RoutedProvider = ChatProvider & { auth: ProviderAuthEntry };

async function driverModels(auth: ActiveProviderAuth): Promise<AutoModel[]> {
	if (auth.kind === "claude") return claudeChatModels(auth);
	const listed = await getDriver(auth.kind).listModels({
		apiKey: auth.apiKey,
		baseUrl: auth.baseUrl,
		serverUrl: auth.serverUrl,
		binaryPath: auth.binaryPath,
		env: auth.env,
	});
	return listed.models.map((model) => ({ id: model.id, name: model.name || model.id }));
}

export function createRoutingChatAgent(deps: RoutingChatAgentDeps = {}): ChatAgent {
	const claude = deps.claude ?? createClaudeChatAgent();
	const aiSdk = deps.aiSdk ?? createAiSdkChatAgent();
	const probe = deps.probeClaudeCli ?? probeClaudeCli;
	const listModels = deps.listModels ?? driverModels;

	/** Why `auth` cannot chat now (its auth mode, its credentials), or null when it can. */
	async function cannotChat(auth: ProviderAuthEntry): Promise<string | null> {
		const driver = getDriver(auth.kind);
		const modes = driver.capabilities.chat;
		if (modes.length === 0) {
			const why = CANNOT_CHAT[auth.kind];
			return `${auth.label} cannot run the Auto chat yet${why ? `: ${why}` : ""}.`;
		}
		if (!modes.includes(auth.authMode)) {
			const key = API_KEY_INSTEAD[auth.kind] ?? "an API key";
			return auth.authMode === "cli"
				? `${auth.label}'s CLI login cannot run the Auto chat yet; add ${key} to ${auth.label} in Settings → Providers.`
				: `${auth.label} cannot run the Auto chat in this auth mode.`;
		}
		if (auth.kind === "claude") return claudeSignInProblem(auth, probe);
		return (await driver.chat?.missingCredential(auth)) ?? null;
	}

	/** `auth` as the chat sees it: whether it can chat now, and its default model. */
	async function routedOne(auth: ProviderAuthEntry): Promise<RoutedProvider> {
		const reason = await cannotChat(auth);
		return {
			id: auth.id,
			kind: auth.kind,
			label: auth.label,
			available: reason === null,
			reason,
			defaultModel: auth.defaultModel?.trim() || getDriver(auth.kind).chat?.defaultModel || null,
			auth,
		};
	}

	/** Every enabled Provider, oldest first, with whether it can chat now. */
	async function routed(): Promise<RoutedProvider[]> {
		const all = (await listProviderAuths()).filter((auth) => auth.enabled);
		return Promise.all(all.map(routedOne));
	}

	/** The app's default Provider when it can chat, else the first that can. */
	function defaultOf(list: RoutedProvider[]): string | null {
		const usable = list.filter((provider) => provider.available);
		return (usable.find((provider) => provider.auth.isDefault) ?? usable[0])?.id ?? null;
	}

	async function providers() {
		const list = await routed();
		return {
			providers: list.map(({ auth: _auth, ...provider }) => provider),
			defaultProviderId: defaultOf(list),
		};
	}

	async function status(): Promise<AutoStatus> {
		const usable = (await routed()).filter((provider) => provider.available);
		if (usable.length === 0) {
			return {
				signedIn: false,
				detail:
					"No Provider can run the Auto chat. Add or sign in a Provider in Settings → Providers.",
			};
		}
		return {
			signedIn: true,
			detail: `Can chat on ${usable.map((provider) => provider.label).join(", ")}.`,
		};
	}

	async function models(): Promise<ListAutoModelsResponse> {
		const list = await routed();
		const withModels = await Promise.all(
			list.map(async ({ auth, ...provider }) => {
				if (!provider.available) return { ...provider, models: [] };
				const listed = await listModels(auth).catch((error: unknown) => {
					// The message only: an error object can carry the request, and with it the key.
					console.error(
						`[auto] listing the models of ${auth.label} failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					return [];
				});
				return { ...provider, models: listed };
			}),
		);
		return { providers: withModels, defaultProviderId: defaultOf(list) };
	}

	/** The chat's Provider, ready to answer, or why it cannot, as the chat's error. */
	async function chatProvider(providerId: string | null): Promise<RoutedProvider> {
		const pick = "Pick another Provider in the composer.";
		if (!providerId) throw new Error(`This chat has no Provider. ${pick}`);
		const all = await listProviderAuths();
		const auth = all.find((entry) => entry.id === providerId);
		if (!auth) throw new Error(`The Provider this chat was on was removed. ${pick}`);
		if (!auth.enabled) {
			throw new Error(
				`This chat's Provider, ${auth.label}, is disabled in Settings → Providers. ${pick}`,
			);
		}
		const found = await routedOne(auth);
		if (!found.available) {
			throw new Error(`${auth.label} cannot answer this chat: ${found.reason} ${pick}`);
		}
		return found;
	}

	async function* runTurn(turn: ChatTurn): AsyncGenerator<ChatAgentEvent> {
		const provider = await chatProvider(turn.providerId);
		if (provider.kind === "claude") {
			yield* claude.runTurn(turn, provider.auth);
			return;
		}
		const modelId = turn.model ?? provider.defaultModel;
		if (!modelId) {
			throw new Error(`${provider.label} has no default model. Pick a model in the composer.`);
		}
		let model: LanguageModel;
		try {
			const factory = getDriver(provider.kind).chat;
			if (!factory) throw new AgentProviderError(`${provider.label} cannot run the Auto chat yet.`);
			model = await factory.createModel(provider.auth, modelId);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : String(error));
		}
		yield* aiSdk.runTurn({ ...turn, model: modelId }, { model, label: provider.label });
	}

	return { status, models, providers, runTurn };
}
