import { describe, expect, test } from "bun:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createAiSdkChatAgent } from "./ai-sdk-agent";
import type { ChatAgentEvent, ChatTool, ChatTurn } from "./chat-agent";

/**
 * The contract of the AI SDK chat agent, the Auto chat's agent on every Provider but Claude,
 * driven by the AI SDK's mock language model: what it streams, which tools it offers and
 * calls, what it saves to resume from, and what each call sends the model.
 */

type StreamPart = LanguageModelV4StreamPart;
type CallOptions = MockLanguageModelV4["doStreamCalls"][number];

const USAGE = {
	inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** One model reply, streamed: text blocks and tool calls in order, then the finish. */
function reply(...parts: Array<string | { tool: string; input: unknown }>) {
	const chunks: unknown[] = [{ type: "stream-start", warnings: [] }];
	let calls = 0;
	parts.forEach((part, index) => {
		if (typeof part === "string") {
			const id = `text-${index}`;
			chunks.push({ type: "text-start", id });
			for (const word of part.split(/(?<= )/)) chunks.push({ type: "text-delta", id, delta: word });
			chunks.push({ type: "text-end", id });
		} else {
			calls += 1;
			chunks.push({
				type: "tool-call",
				toolCallId: `call-${index}`,
				toolName: part.tool,
				input: JSON.stringify(part.input),
			});
		}
	});
	chunks.push({
		type: "finish",
		finishReason: { unified: calls > 0 ? "tool-calls" : "stop", raw: undefined },
		usage: USAGE,
	});
	return chunks as StreamPart[];
}

/** A mock model that answers each call with the next of `replies` (the last one again after). */
function modelReplying(replies: StreamPart[][], provider = "openai.chat") {
	let call = 0;
	return new MockLanguageModelV4({
		provider,
		modelId: "mock-chat",
		doStream: async () => {
			const next = replies[Math.min(call, replies.length - 1)];
			call += 1;
			if (!next) throw new Error("no reply scripted");
			return { stream: simulateReadableStream({ chunks: next }) };
		},
	});
}

const readCase: ChatTool = {
	name: "get_test_case",
	description: "Read a Test Case",
	modes: ["ask", "run", "explore"],
	input: { number: z.number().int().optional() },
	run: async () => ({ text: "#8 Login", isError: false }),
};

function turnOf(overrides: Partial<ChatTurn> = {}): ChatTurn {
	return {
		chatId: "chat_1",
		prompt: "[Ask mode] Why did the last run fail?",
		mode: "ask",
		providerId: "prov_openai",
		model: null,
		agentSessionId: null,
		agentHistory: null,
		conversation: null,
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

/** The text of each tool result sent to the model in `call`. */
function toolResults(call: CallOptions | undefined): string[] {
	return (call?.prompt ?? []).flatMap((message) =>
		message.role === "tool"
			? message.content.flatMap((part) => {
					if (part.type !== "tool-result") return [];
					const output = part.output;
					if (output.type === "text" || output.type === "error-text") return [output.value];
					return [JSON.stringify(output)];
				})
			: [],
	);
}

function historyOf(events: ChatAgentEvent[]): string {
	const saved = events.filter((event) => event.type === "agent_history").at(-1);
	if (saved?.type !== "agent_history") throw new Error("no history saved");
	return saved.agentHistory;
}

/** What `call` sent the model, one line per message part: `role: text`. */
function transcript(call: CallOptions | undefined): string[] {
	return (call?.prompt ?? []).flatMap((message) => {
		if (message.role === "system") return [`system: ${message.content}`];
		return message.content.flatMap((part) => {
			if (part.type === "text") return [`${message.role}: ${part.text}`];
			if (part.type === "tool-call") return [`${message.role}: tool ${part.toolName}`];
			if (part.type === "tool-result") {
				const output = part.output;
				const text = output.type === "text" || output.type === "error-text" ? output.value : "";
				return [`${message.role}: ${text}`];
			}
			return [];
		});
	});
}

function texts(events: ChatAgentEvent[]): string[] {
	return events.flatMap((event) => (event.type === "text" ? [event.delta] : []));
}

describe("the AI SDK chat agent", () => {
	test("streams the reply word by word, and a new text block starts a paragraph", async () => {
		const model = modelReplying([reply("The run failed. ", "Want me to fix it?")]);
		const agent = createAiSdkChatAgent();

		const events = await collect(agent.runTurn(turnOf(), { model, label: "OpenAI" }));

		expect(texts(events)).toEqual([
			"The ",
			"run ",
			"failed. ",
			"\n\n",
			"Want ",
			"me ",
			"to ",
			"fix ",
			"it?",
		]);
	});

	test("offers only the mode's tools, and each call goes through the chat's callTool", async () => {
		const model = modelReplying([
			reply({ tool: "get_test_case", input: { number: 8 } }),
			reply("It is #8 Login."),
		]);
		const calls: Array<[string, unknown]> = [];
		const agent = createAiSdkChatAgent();

		const events = await collect(
			agent.runTurn(
				turnOf({
					callTool: async (name, input) => {
						calls.push([name, input]);
						return { text: "#8 Login: 3 steps", isError: false };
					},
				}),
				{ model, label: "OpenAI" },
			),
		);

		expect(model.doStreamCalls[0]?.tools?.map((tool) => tool.name)).toEqual(["get_test_case"]);
		expect(calls).toEqual([["get_test_case", { number: 8 }]]);
		expect(toolResults(model.doStreamCalls[1])).toEqual(["#8 Login: 3 steps"]);
		expect(texts(events).join("")).toBe("It is #8 Login.");
	});

	test("a tool the mode does not offer is refused, and never reaches callTool", async () => {
		const model = modelReplying([
			reply({ tool: "remove_draft_step", input: { step: 1, reason: "Not needed" } }),
			reply("I cannot change the draft in Ask mode."),
		]);
		const calls: string[] = [];
		const agent = createAiSdkChatAgent();

		await collect(
			agent.runTurn(
				turnOf({
					callTool: async (name) => {
						calls.push(name);
						return { text: "", isError: false };
					},
				}),
				{ model, label: "OpenAI" },
			),
		);

		expect(calls).toEqual([]);
		expect(toolResults(model.doStreamCalls[1])?.[0]).toContain("remove_draft_step");
	});

	test("stops after the cap of tool steps, with a message saying so", async () => {
		const model = modelReplying([reply({ tool: "get_test_case", input: { number: 8 } })]);
		const agent = createAiSdkChatAgent({ maxToolSteps: 3 });

		const turn = collect(
			agent.runTurn(turnOf({ callTool: async () => ({ text: "#8", isError: false }) }), {
				model,
				label: "OpenAI",
			}),
		);

		await expect(turn).rejects.toThrow("stopped after 3 tool steps");
		expect(model.doStreamCalls).toHaveLength(3);
	});

	test("Stop ends the turn at once: no further model call, nothing saved", async () => {
		const model = modelReplying([
			reply("Reading. ", { tool: "get_test_case", input: { number: 8 } }),
			reply("Never sent."),
		]);
		const stop = new AbortController();
		const agent = createAiSdkChatAgent();

		const events = await collect(
			agent.runTurn(
				turnOf({
					signal: stop.signal,
					callTool: async () => {
						stop.abort();
						return { text: "#8", isError: false };
					},
				}),
				{ model, label: "OpenAI" },
			),
		);

		expect(model.doStreamCalls).toHaveLength(1);
		expect(texts(events)).not.toContain("Never ");
		expect(events.some((event) => event.type === "agent_history")).toBe(false);
	});

	test("a vendor error becomes one sentence naming the Provider", async () => {
		const cases: Array<[number, string, string]> = [
			[
				401,
				'{"error":{"message":"Incorrect API key"}}',
				"The Work OpenAI Provider rejected its credentials",
			],
			[429, '{"error":{"message":"Slow down"}}', "The Work OpenAI Provider is rate limited"],
			[429, '{"error":{"code":"insufficient_quota"}}', "billing problem"],
			[402, '{"error":{"message":"Payment required"}}', "billing problem"],
			[
				404,
				'{"error":{"code":"model_not_found"}}',
				"The chat model is not available to this Work OpenAI account",
			],
			[
				400,
				'{"error":{"message":"This model does not support tools"}}',
				"This Work OpenAI model cannot call tools",
			],
		];
		for (const [statusCode, responseBody, expected] of cases) {
			const model = new MockLanguageModelV4({
				provider: "openai.chat",
				modelId: "mock-chat",
				doStream: async () => {
					throw new APICallError({
						message: "Request failed",
						url: "https://api.openai.com/v1/chat/completions",
						requestBodyValues: {},
						statusCode,
						responseBody,
						isRetryable: false,
					});
				},
			});
			const agent = createAiSdkChatAgent();
			await expect(
				collect(agent.runTurn(turnOf(), { model, label: "Work OpenAI" })),
			).rejects.toThrow(expected);
		}
	});

	test("saves its history after a turn, tool calls and results included, and goes on from it next turn", async () => {
		const model = modelReplying([
			reply({ tool: "get_test_case", input: { number: 8 } }),
			reply("It has 3 steps."),
			reply("Step 2 taps Log in."),
		]);
		const agent = createAiSdkChatAgent();
		const callTool = async () => ({ text: "#8 Login: 3 steps", isError: false });

		const first = await collect(
			agent.runTurn(turnOf({ prompt: "[Ask mode] How long is #8?", callTool }), {
				model,
				label: "OpenAI",
			}),
		);
		const saved = historyOf(first);
		await collect(
			agent.runTurn(turnOf({ prompt: "[Ask mode] And step 2?", agentHistory: saved, callTool }), {
				model,
				label: "OpenAI",
			}),
		);

		expect(transcript(model.doStreamCalls[2])).toEqual([
			"system: You are the chat agent.",
			"user: [Ask mode] How long is #8?",
			"assistant: tool get_test_case",
			"tool: #8 Login: 3 steps",
			"assistant: It has 3 steps.",
			"user: [Ask mode] And step 2?",
		]);
	});

	test("with nothing of its own to go on from, starts from the chat's visible conversation", async () => {
		const model = modelReplying([reply("Carrying on.")]);
		const agent = createAiSdkChatAgent();

		await collect(
			agent.runTurn(
				turnOf({
					prompt: "[Ask mode] Go on",
					conversation: "User: Why did #8 fail?\nAgent: Step 2 timed out.",
				}),
				{ model, label: "OpenAI" },
			),
		);

		const [, user] = transcript(model.doStreamCalls[0]);
		expect(user).toContain("Agent: Step 2 timed out.");
		expect(user?.endsWith("[Ask mode] Go on")).toBe(true);
	});

	test("a history over its share of the context budget is compacted: the oldest turns become one saved summary, the latest kept verbatim", async () => {
		const long = "word ".repeat(400);
		const toolResult = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n");
		const model = new MockLanguageModelV4({
			provider: "openai.chat",
			modelId: "mock-chat",
			doStream: async ({ prompt }) => {
				const last = prompt.at(-1);
				const chunks =
					last?.role === "user" ? reply({ tool: "get_test_case", input: {} }) : reply(long);
				return { stream: simulateReadableStream({ chunks }) };
			},
			doGenerate: async () => ({
				content: [{ type: "text", text: "SUMMARY: #8 fails at step 2." }],
				finishReason: { unified: "stop", raw: undefined },
				usage: USAGE,
				warnings: [],
			}),
		});
		const agent = createAiSdkChatAgent({ contextBudgetTokens: 2500, keepTurns: 1 });
		const callTool = async () => ({ text: toolResult, isError: false });

		let history: string | null = null;
		for (const prompt of [
			"first question",
			"second question",
			"third question",
			"fourth question",
			"fifth question",
		]) {
			const events = await collect(
				agent.runTurn(turnOf({ prompt, agentHistory: history, callTool }), {
					model,
					label: "OpenAI",
				}),
			);
			history = historyOf(events);
		}

		expect(model.doGenerateCalls).toHaveLength(1);
		const summaryCall = model.doGenerateCalls[0];
		expect(summaryCall?.tools ?? []).toEqual([]);
		const summarized = transcript(summaryCall).join("\n");
		expect(summarized).toContain("first question");
		expect(summarized).toContain("second question");
		expect(summarized).not.toContain("third question");
		expect(summarized).toContain("line 1");
		expect(summarized).not.toContain("line 9");

		// The fourth turn's call: the summary, then the third turn as it was, then the new prompt.
		const fourth = transcript(model.doStreamCalls[6]);
		expect(fourth[0]).toContain("SUMMARY: #8 fails at step 2.");
		expect(fourth[1]).toBe("user: third question");
		expect(fourth).toContain(
			"tool: line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9",
		);
		expect(fourth.some((line) => line.includes("first question"))).toBe(false);
		// The fifth goes on from the saved summary, without writing it again.
		expect(transcript(model.doStreamCalls[8])[0]).toContain("SUMMARY: #8 fails at step 2.");
	});

	test("on Anthropic, marks the system prompt and the history before the new prompt for the Prompt cache; elsewhere, nothing", async () => {
		const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } };
		for (const [provider, marked] of [
			["anthropic.messages", true],
			["openai.chat", false],
		] as const) {
			const model = modelReplying([reply("First."), reply("Second.")], provider);
			const agent = createAiSdkChatAgent();
			const first = await collect(agent.runTurn(turnOf(), { model, label: "Anthropic" }));
			await collect(
				agent.runTurn(turnOf({ prompt: "[Ask mode] Again", agentHistory: historyOf(first) }), {
					model,
					label: "Anthropic",
				}),
			);

			const prompt = model.doStreamCalls[1]?.prompt ?? [];
			const [system, , answer, latest] = prompt;
			expect(prompt.map((message) => message.role)).toEqual([
				"system",
				"user",
				"assistant",
				"user",
			]);
			expect(system?.providerOptions).toEqual(marked ? CACHE : undefined);
			expect(answer?.providerOptions).toEqual(marked ? CACHE : undefined);
			expect(latest?.providerOptions).toBeUndefined();
		}
	});
});
