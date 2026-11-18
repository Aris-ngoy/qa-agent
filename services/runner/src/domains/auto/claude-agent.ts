import { mkdir } from "node:fs/promises";
import {
	type Options,
	type SDKMessage,
	createSdkMcpServer,
	query as sdkQuery,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AutoModel, AutoStatus, ListAutoModelsResponse } from "@yoqa/runner-client";
import { type ActiveProviderAuth, resolveProviderAuthOfKind } from "../providers/application";
import { claudeDriver } from "../providers/drivers/claude";
import type { ChatAgent, ChatAgentEvent, ChatTool, ChatTurn } from "./chat-agent";
import { autoChatDir } from "./chat-dir";

/**
 * The Auto chat agent on the Claude Agent SDK (ADR 0012), signed in through the Claude
 * Provider. Each turn runs isolated: no Claude Code tools, no settings, CLAUDE.md or skills,
 * an empty working folder per chat, and only the Yoqa tools of the message's mode.
 */

/** The in-process MCP server the Yoqa tools are served from. */
const YOQA_MCP_SERVER = "yoqa";

/** The models Claude Code knows by alias, for a CLI login, where there is no model list. */
const CLI_MODELS: AutoModel[] = [
	{ id: "opus", name: "Opus" },
	{ id: "sonnet", name: "Sonnet" },
	{ id: "haiku", name: "Haiku" },
];

const SIGN_IN_HINT = "Sign in the Claude Provider in Settings → Providers → Claude.";

export type ClaudeQuery = (params: {
	prompt: string;
	options: Options;
}) => AsyncIterable<SDKMessage>;

export type ClaudeChatAgentDeps = {
	/** The SDK's `query`; faked in the contract test. */
	query?: ClaudeQuery;
	/** The Claude Provider's credentials; null when there is none. */
	resolveAuth?: () => Promise<ActiveProviderAuth | null>;
};

function apiKeyOf(auth: ActiveProviderAuth): string | null {
	return auth.apiKey?.trim() || auth.env.ANTHROPIC_API_KEY?.trim() || null;
}

/**
 * The SDK process's environment: the runner's, the Provider's, and its API key when it has one.
 * A CLI login drops an API key the runner inherited, which Claude Code would use over the login.
 */
function sdkEnv(auth: ActiveProviderAuth): Record<string, string | undefined> {
	const apiKey = auth.authMode === "api_key" ? apiKeyOf(auth) : null;
	const { ANTHROPIC_API_KEY: _inherited, ...runnerEnv } = process.env;
	return {
		...(auth.authMode === "api_key" ? process.env : runnerEnv),
		...auth.env,
		CLAUDE_AGENT_SDK_CLIENT_APP: "yoqa-runner",
		...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
	};
}

function sdkToolName(name: string): string {
	return `mcp__${YOQA_MCP_SERVER}__${name}`;
}

/** The mode's Yoqa tools as SDK tools; each call goes through the chat's `callTool`. */
function sdkTools(tools: ChatTool[], callTool: ChatTurn["callTool"]) {
	return tools.map((yoqaTool) =>
		tool(yoqaTool.name, yoqaTool.description, yoqaTool.input, async (args) => {
			const output = await callTool(yoqaTool.name, args);
			return { content: [{ type: "text", text: output.text }], isError: output.isError };
		}),
	);
}

/** The reason an SDK error stops a turn, in the chat's words. */
function assistantErrorText(error: string): string {
	switch (error) {
		case "authentication_failed":
		case "oauth_org_not_allowed":
			return `The Claude Provider is not signed in. ${SIGN_IN_HINT}`;
		case "billing_error":
			return "The Claude account behind the Claude Provider has a billing problem.";
		case "rate_limit":
			return "The Claude Provider is rate limited. Try again in a moment.";
		case "model_not_found":
			return "The chat model is not available to this Claude account. Pick another one.";
		default:
			return `The chat agent stopped: ${error}.`;
	}
}

/**
 * What one SDK message says to the chat. Only the main agent's streamed text counts (the
 * whole assistant message repeats it); a new text block starts a new paragraph.
 */
function chatEventsOf(message: SDKMessage, state: { textBlocks: number }): ChatAgentEvent[] {
	switch (message.type) {
		case "system":
			return message.subtype === "init"
				? [{ type: "agent_session", agentSessionId: message.session_id }]
				: [];
		case "stream_event": {
			if (message.parent_tool_use_id !== null) return [];
			const event = message.event;
			if (event.type === "content_block_start" && event.content_block.type === "text") {
				state.textBlocks += 1;
				return state.textBlocks > 1 ? [{ type: "text", delta: "\n\n" }] : [];
			}
			if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
				return [{ type: "text", delta: event.delta.text }];
			}
			return [];
		}
		case "assistant":
			if (message.error) throw new Error(assistantErrorText(message.error));
			return [];
		case "result":
			if (message.subtype !== "success") {
				throw new Error(message.errors.join("; ") || `The chat agent stopped: ${message.subtype}.`);
			}
			if (message.is_error) throw new Error(message.result || "The chat agent stopped.");
			return [];
		default:
			return [];
	}
}

export function createClaudeChatAgent(deps: ClaudeChatAgentDeps = {}): ChatAgent {
	const query: ClaudeQuery = deps.query ?? sdkQuery;
	const resolveAuth = deps.resolveAuth ?? (() => resolveProviderAuthOfKind("claude"));

	async function status(): Promise<AutoStatus> {
		const auth = await resolveAuth();
		if (!auth) {
			return {
				signedIn: false,
				providerId: null,
				detail: "There is no Claude Provider. Add one in Settings → Providers → Claude.",
			};
		}
		if (auth.authMode === "api_key") {
			return apiKeyOf(auth)
				? { signedIn: true, providerId: auth.id, detail: "Signed in with an Anthropic API key" }
				: {
						signedIn: false,
						providerId: auth.id,
						detail: `The Claude Provider has no API key. ${SIGN_IN_HINT}`,
					};
		}
		const probe = await claudeDriver.probe(auth.binaryPath);
		return {
			signedIn: probe.found && probe.authenticated === true,
			providerId: auth.id,
			detail: probe.detail || SIGN_IN_HINT,
		};
	}

	async function models(): Promise<ListAutoModelsResponse> {
		const auth = await resolveAuth();
		const defaultModel = auth?.defaultModel?.trim() || null;
		if (!auth || auth.authMode !== "api_key" || !apiKeyOf(auth)) {
			return { models: CLI_MODELS, defaultModel };
		}
		const listed = await claudeDriver.listModels({
			apiKey: apiKeyOf(auth),
			baseUrl: auth.baseUrl,
			serverUrl: auth.serverUrl,
			binaryPath: auth.binaryPath,
			env: auth.env,
		});
		return { models: listed.models.length > 0 ? listed.models : CLI_MODELS, defaultModel };
	}

	async function* runTurn(turn: ChatTurn): AsyncGenerator<ChatAgentEvent> {
		const auth = await resolveAuth();
		if (!auth) throw new Error(`There is no Claude Provider. ${SIGN_IN_HINT}`);
		const cwd = autoChatDir(turn.chatId);
		await mkdir(cwd, { recursive: true });
		const abortController = new AbortController();
		turn.signal.addEventListener("abort", () => abortController.abort(), { once: true });
		const model = turn.model ?? (auth.defaultModel?.trim() || null);

		const options: Options = {
			cwd,
			tools: [],
			settingSources: [],
			strictMcpConfig: true,
			mcpServers: {
				[YOQA_MCP_SERVER]: createSdkMcpServer({
					name: YOQA_MCP_SERVER,
					version: "1.0.0",
					tools: sdkTools(turn.tools, turn.callTool),
				}),
			},
			allowedTools: turn.tools.map((yoqaTool) => sdkToolName(yoqaTool.name)),
			permissionMode: "dontAsk",
			systemPrompt: turn.systemPrompt,
			includePartialMessages: true,
			abortController,
			env: sdkEnv(auth),
			...(turn.agentSessionId ? { resume: turn.agentSessionId } : {}),
			...(model ? { model } : {}),
		};
		const state = { textBlocks: 0 };
		for await (const message of query({ prompt: turn.prompt, options })) {
			yield* chatEventsOf(message, state);
		}
	}

	return { status, models, runTurn };
}
