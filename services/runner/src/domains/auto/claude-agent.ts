import { mkdir } from "node:fs/promises";
import {
	type Options,
	type SDKMessage,
	createSdkMcpServer,
	query as sdkQuery,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AutoModel } from "@yoqa/runner-client";
import type { ActiveProviderAuth } from "../providers/application";
import { claudeDriver } from "../providers/drivers/claude";
import { resolveBinary } from "../providers/drivers/probe";
import {
	type ChatAgentEvent,
	type ChatTool,
	type ChatTurn,
	promptWithConversation,
} from "./chat-agent";
import { autoChatDir } from "./chat-dir";

/**
 * The Auto chat agent for the Claude Provider, on the Claude Agent SDK (ADR 0012, ADR 0014):
 * its CLI login or an API key. Each turn runs isolated: no Claude Code tools, no settings,
 * CLAUDE.md or skills, an empty working folder per chat, and only the Yoqa tools of the
 * message's mode.
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

/**
 * Whether this runner is a `bun build --compile` binary, as in the desktop app. There the SDK
 * cannot find the Claude Code binary it ships: it resolves it from inside `$bunfs` (`~BUN` on
 * Windows), where no package is installed.
 */
const RUNS_COMPILED = /\/(\$bunfs|~BUN)\//.test(import.meta.url);

export type ClaudeQuery = (params: {
	prompt: string;
	options: Options;
}) => AsyncIterable<SDKMessage>;

export type ClaudeChatAgentDeps = {
	/** The SDK's `query`; faked in the contract test. */
	query?: ClaudeQuery;
	/** Whether the runner is a compiled binary; detected when unset. */
	compiled?: boolean;
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

/**
 * The Claude Code binary the SDK starts: in a compiled runner, the Provider's Claude CLI (its
 * binary path, else `claude` on PATH); otherwise null, for the one the SDK ships.
 */
async function claudeExecutable(
	auth: ActiveProviderAuth,
	compiled: boolean,
): Promise<string | null> {
	if (!compiled) return null;
	const resolved = await resolveBinary("claude", auth.binaryPath);
	if (!resolved.path) {
		throw new Error(
			`The Claude Provider needs the Claude Code CLI to chat: ${resolved.detail}. Install it, or set its path in Settings → Providers → Claude.`,
		);
	}
	return resolved.path;
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

/**
 * Why this Claude Provider cannot chat (no API key, the CLI login signed out), or null when it
 * can. `probeCli` checks the Claude CLI login (`claude auth status`).
 */
export async function claudeSignInProblem(
	auth: ActiveProviderAuth,
	probeCli: (binaryPath: string | null) => Promise<{ signedIn: boolean; detail: string }>,
): Promise<string | null> {
	if (auth.authMode === "api_key") {
		return apiKeyOf(auth) ? null : `It has no API key. ${SIGN_IN_HINT}`;
	}
	const probe = await probeCli(auth.binaryPath);
	return probe.signedIn ? null : probe.detail || SIGN_IN_HINT;
}

/** Whether the Claude CLI login is signed in, by `claude auth status`. */
export async function probeClaudeCli(
	binaryPath: string | null,
): Promise<{ signedIn: boolean; detail: string }> {
	const probe = await claudeDriver.probe(binaryPath);
	return { signedIn: probe.found && probe.authenticated === true, detail: probe.detail };
}

/** A Claude Provider's chat models: its API's list with a key, else Claude Code's aliases. */
export async function claudeChatModels(auth: ActiveProviderAuth): Promise<AutoModel[]> {
	const apiKey = auth.authMode === "api_key" ? apiKeyOf(auth) : null;
	if (!apiKey) return CLI_MODELS;
	const listed = await claudeDriver.listModels({
		apiKey,
		baseUrl: auth.baseUrl,
		serverUrl: auth.serverUrl,
		binaryPath: auth.binaryPath,
		env: auth.env,
	});
	return listed.models.length > 0 ? listed.models : CLI_MODELS;
}

export function createClaudeChatAgent(deps: ClaudeChatAgentDeps = {}) {
	const query: ClaudeQuery = deps.query ?? sdkQuery;
	const compiled = deps.compiled ?? RUNS_COMPILED;

	/** Answer `turn` on the Claude Provider signed in with `auth`. */
	async function* runTurn(
		turn: ChatTurn,
		auth: ActiveProviderAuth,
	): AsyncGenerator<ChatAgentEvent> {
		const cwd = autoChatDir(turn.chatId);
		await mkdir(cwd, { recursive: true });
		const abortController = new AbortController();
		turn.signal.addEventListener("abort", () => abortController.abort(), { once: true });
		const model = turn.model ?? (auth.defaultModel?.trim() || null);
		const executable = await claudeExecutable(auth, compiled);

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
			...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
		};
		const prompt = turn.agentSessionId ? turn.prompt : promptWithConversation(turn);
		const state = { textBlocks: 0 };
		for await (const message of query({ prompt, options })) {
			yield* chatEventsOf(message, state);
		}
	}

	return { runTurn };
}
