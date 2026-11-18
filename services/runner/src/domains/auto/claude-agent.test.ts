import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ActiveProviderAuth } from "../providers/application";
import type { ChatAgentEvent, ChatTool, ChatTurn } from "./chat-agent";
import { createClaudeChatAgent } from "./claude-agent";

/**
 * The contract between Auto and the Claude Agent SDK, with the SDK's `query` faked: what the
 * adapter asks the SDK for, and how what the SDK says becomes chat events.
 */

const CLAUDE_KEY_AUTH: ActiveProviderAuth = {
	id: "prov_claude",
	kind: "claude",
	authMode: "api_key",
	apiKey: "sk-ant-test",
	baseUrl: null,
	serverUrl: null,
	defaultModel: null,
	binaryPath: "claude",
	env: {},
};

const readCase: ChatTool = {
	name: "get_test_case",
	description: "Read a Test Case",
	modes: ["ask", "run", "explore"],
	input: { number: z.number().int().optional() },
	run: async () => ({ text: "#8 Login", isError: false }),
};

/** A fake `query` that records what it was asked, and answers with `messages`. */
function fakeQuery(messages: SDKMessage[]) {
	const calls: Array<{ prompt: string; options: Options }> = [];
	const query = (params: { prompt: string; options: Options }) => {
		calls.push(params);
		return (async function* () {
			for (const message of messages) yield message;
		})();
	};
	return { calls, query };
}

const base = { uuid: "00000000-0000-0000-0000-000000000000", session_id: "sess_1" } as const;

function init(): SDKMessage {
	return { ...base, type: "system", subtype: "init" } as unknown as SDKMessage;
}

function streamed(event: unknown): SDKMessage {
	return {
		...base,
		type: "stream_event",
		parent_tool_use_id: null,
		event,
	} as unknown as SDKMessage;
}

function textStart(): SDKMessage {
	return streamed({
		type: "content_block_start",
		index: 0,
		content_block: { type: "text", text: "" },
	});
}

function textDelta(text: string): SDKMessage {
	return streamed({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
}

function success(): SDKMessage {
	return {
		...base,
		type: "result",
		subtype: "success",
		is_error: false,
		result: "done",
	} as unknown as SDKMessage;
}

async function turnOf(overrides: Partial<ChatTurn> = {}): Promise<ChatTurn> {
	return {
		chatId: `chat_${crypto.randomUUID()}`,
		prompt: "[Ask mode] Why did the last run fail?",
		mode: "ask",
		model: null,
		agentSessionId: null,
		systemPrompt: "You are the chat agent.",
		tools: [readCase],
		callTool: async () => ({ text: "", isError: false }),
		signal: new AbortController().signal,
		...overrides,
	};
}

async function collect(events: AsyncIterable<ChatAgentEvent>): Promise<ChatAgentEvent[]> {
	const out: ChatAgentEvent[] = [];
	for await (const event of events) out.push(event);
	return out;
}

describe("the Claude Agent SDK adapter", () => {
	test("runs with no built-in tools, no setting sources, and only the mode's Yoqa tools, in the chat's own folder", async () => {
		const chatsDir = await mkdtemp(`${tmpdir()}/auto-chats-`);
		process.env.YOQA_AUTO_CHATS_DIR = chatsDir;
		const { calls, query } = fakeQuery([init(), success()]);
		const agent = createClaudeChatAgent({ query, resolveAuth: async () => CLAUDE_KEY_AUTH });
		const turn = await turnOf();

		await collect(agent.runTurn(turn));
		Reflect.deleteProperty(process.env, "YOQA_AUTO_CHATS_DIR");

		const options = calls[0]?.options;
		expect(calls[0]?.prompt).toBe(turn.prompt);
		expect(options?.tools).toEqual([]);
		expect(options?.settingSources).toEqual([]);
		expect(options?.strictMcpConfig).toBe(true);
		expect(options?.permissionMode).toBe("dontAsk");
		expect(Object.keys(options?.mcpServers ?? {})).toEqual(["yoqa"]);
		expect(options?.allowedTools).toEqual(["mcp__yoqa__get_test_case"]);
		expect(options?.systemPrompt).toBe("You are the chat agent.");
		expect(options?.cwd).toBe(`${chatsDir}/${turn.chatId}`);
		expect(existsSync(`${chatsDir}/${turn.chatId}`)).toBe(true);
		expect(options?.env?.ANTHROPIC_API_KEY).toBe("sk-ant-test");
	});

	test("resumes the chat's session and uses its model", async () => {
		const { calls, query } = fakeQuery([init(), success()]);
		const agent = createClaudeChatAgent({ query, resolveAuth: async () => CLAUDE_KEY_AUTH });

		await collect(
			agent.runTurn(await turnOf({ agentSessionId: "sess_earlier", model: "claude-opus-5-5" })),
		);
		await collect(agent.runTurn(await turnOf()));

		expect(calls[0]?.options.resume).toBe("sess_earlier");
		expect(calls[0]?.options.model).toBe("claude-opus-5-5");
		expect(calls[1]?.options.resume).toBeUndefined();
		expect(calls[1]?.options.model).toBeUndefined();
	});

	test("maps the session, streamed text and a second text block onto chat events", async () => {
		const { query } = fakeQuery([
			init(),
			textStart(),
			textDelta("The run "),
			textDelta("failed at step 3."),
			textStart(),
			textDelta("Want me to fix it?"),
			success(),
		]);
		const agent = createClaudeChatAgent({ query, resolveAuth: async () => CLAUDE_KEY_AUTH });

		expect(await collect(agent.runTurn(await turnOf()))).toEqual([
			{ type: "agent_session", agentSessionId: "sess_1" },
			{ type: "text", delta: "The run " },
			{ type: "text", delta: "failed at step 3." },
			{ type: "text", delta: "\n\n" },
			{ type: "text", delta: "Want me to fix it?" },
		]);
	});

	test("a failed result or a refused sign-in ends the turn with its reason", async () => {
		const failed = fakeQuery([
			init(),
			{
				...base,
				type: "result",
				subtype: "error_during_execution",
				is_error: true,
				errors: ["boom"],
			} as unknown as SDKMessage,
		]);
		const agent = createClaudeChatAgent({
			query: failed.query,
			resolveAuth: async () => CLAUDE_KEY_AUTH,
		});
		await expect(collect(agent.runTurn(await turnOf()))).rejects.toThrow("boom");

		const unauthorised = fakeQuery([
			init(),
			{
				...base,
				type: "assistant",
				parent_tool_use_id: null,
				error: "authentication_failed",
				message: { content: [] },
			} as unknown as SDKMessage,
		]);
		const refused = createClaudeChatAgent({
			query: unauthorised.query,
			resolveAuth: async () => CLAUDE_KEY_AUTH,
		});
		await expect(collect(refused.runTurn(await turnOf()))).rejects.toThrow("sign");
	});

	test("a CLI login does not pass on an API key the runner inherited", async () => {
		const { calls, query } = fakeQuery([init(), success()]);
		const cliAuth: ActiveProviderAuth = { ...CLAUDE_KEY_AUTH, authMode: "cli", apiKey: null };
		const agent = createClaudeChatAgent({ query, resolveAuth: async () => cliAuth });
		process.env.ANTHROPIC_API_KEY = "sk-ant-inherited";

		await collect(agent.runTurn(await turnOf()));
		Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");

		expect(calls[0]?.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
		expect(calls[0]?.options.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("yoqa-runner");
	});

	test("with no Claude Provider it is not signed in, and runs nothing", async () => {
		const { calls, query } = fakeQuery([init(), success()]);
		const agent = createClaudeChatAgent({ query, resolveAuth: async () => null });

		expect(await agent.status()).toMatchObject({ signedIn: false, providerId: null });
		await expect(collect(agent.runTurn(await turnOf()))).rejects.toThrow("Claude Provider");
		expect(calls).toEqual([]);
	});
});
