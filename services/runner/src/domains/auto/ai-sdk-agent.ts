import {
	APICallError,
	type LanguageModel,
	type ModelMessage,
	RetryError,
	type ToolSet,
	UnsupportedFunctionalityError,
	generateText,
	isStepCount,
	streamText,
	tool,
} from "ai";
import { z } from "zod";
import { ANTHROPIC_CACHE_BREAKPOINT, isAnthropicModel } from "../providers/vision-model";
import { type ChatAgentEvent, type ChatTurn, promptWithConversation } from "./chat-agent";

/**
 * The Auto chat agent on every Chat-capable Provider but Claude (ADR 0014): one loop Yoqa owns,
 * on the AI SDK. Each turn is one streaming text call that repeats while the model calls
 * Yoqa's tools, up to a cap; its only tools are the mode's Yoqa tools, each going through the
 * chat's `callTool`. What it resumes from next turn is its history, saved with the chat.
 */

/** Tool steps (model calls) one turn may take before it is stopped. */
const MAX_TOOL_STEPS = 25;
/**
 * The context budget a chat's history is held to, in estimated tokens. Models do not say
 * their context size, so it is one fixed figure, well inside the common 128k windows.
 */
const CONTEXT_BUDGET_TOKENS = 80_000;
/** Past this share of the budget, the oldest turns are compacted before the next turn. */
const COMPACT_AT_SHARE = 0.6;
/** The latest turns compaction keeps verbatim. */
const KEEP_TURNS = 4;
/** The lines of an old tool result kept for the summary. */
const SUMMARY_TOOL_LINES = 3;

const SUMMARY_SYSTEM = [
	"You summarize the older part of a chat between a user and the agent of Yoqa's Auto screen, for the agent that carries the chat on.",
	"Keep what the user asked for, the decisions made, Test Case numbers, step numbers, Run ids and results, changes to the Case draft, and what is still open.",
	"Plain text, at most 300 words. Never invent anything the transcript does not say.",
].join("\n");

/** The Provider a turn runs on: its language model for the chat's model, and its label. */
export type AiSdkChatTarget = { model: LanguageModel; label: string };

export type AiSdkChatAgentOptions = {
	/** Model calls per turn before it is stopped; 25 by default. */
	maxToolSteps?: number;
	/** The context budget a history is compacted to stay inside, in estimated tokens. */
	contextBudgetTokens?: number;
	/** The latest turns compaction keeps verbatim. */
	keepTurns?: number;
};

/**
 * What the agent goes on from next turn, saved with the chat as JSON: the model messages since
 * the last compaction (tool calls and their results included), and one summary of the turns
 * before them.
 */
type ChatHistory = {
	version: 1;
	/** The summary of the oldest turns, written by compaction; null before the first. */
	summary: string | null;
	/** How many turns the summary covers. */
	summarizedTurns: number;
	messages: ModelMessage[];
};

const historySchema = z.object({
	version: z.literal(1),
	summary: z.string().nullable(),
	summarizedTurns: z.number().int().nonnegative(),
	messages: z.array(z.object({ role: z.string() }).passthrough()),
});

function emptyHistory(): ChatHistory {
	return { version: 1, summary: null, summarizedTurns: 0, messages: [] };
}

/** The saved history; an empty one when there is none or it cannot be read. */
function parseHistory(raw: string | null): ChatHistory {
	if (!raw) return emptyHistory();
	try {
		const parsed = historySchema.safeParse(JSON.parse(raw));
		return parsed.success ? (parsed.data as ChatHistory) : emptyHistory();
	} catch {
		return emptyHistory();
	}
}

/** The system prompt, and the summary of the oldest turns once there is one. */
function systemWithSummary(systemPrompt: string, history: ChatHistory): string {
	if (!history.summary) return systemPrompt;
	return `${systemPrompt}\n\nThe ${history.summarizedTurns} oldest turns of this chat, summarized:\n${history.summary}`;
}

/** A rough token count: four characters a token, with no tokenizer. */
function estimateTokens(history: ChatHistory): number {
	return Math.ceil(((history.summary ?? "").length + JSON.stringify(history.messages).length) / 4);
}

/** The history's messages split into turns, each starting at a user message. */
function turnsOf(messages: ModelMessage[]): ModelMessage[][] {
	const turns: ModelMessage[][] = [];
	for (const message of messages) {
		const current = turns.at(-1);
		if (message.role === "user" || !current) turns.push([message]);
		else current.push(message);
	}
	return turns;
}

function firstLines(text: string, lines: number): string {
	const all = text.split("\n");
	return all.length > lines ? `${all.slice(0, lines).join("\n")}\n…` : text;
}

/** Older turns as plain text for the summary, each tool result cut to its first lines. */
function transcriptOf(messages: ModelMessage[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		if (message.role === "system") continue;
		if (typeof message.content === "string") {
			lines.push(`${message.role === "user" ? "User" : "Agent"}: ${message.content}`);
			continue;
		}
		for (const part of message.content) {
			if (part.type === "text") {
				lines.push(`${message.role === "user" ? "User" : "Agent"}: ${part.text}`);
			} else if (part.type === "tool-call") {
				lines.push(`Agent called ${part.toolName} ${JSON.stringify(part.input)}`);
			} else if (part.type === "tool-result") {
				const output = part.output;
				const text =
					output.type === "text" || output.type === "error-text"
						? output.value
						: JSON.stringify(output);
				lines.push(`${part.toolName} answered: ${firstLines(text, SUMMARY_TOOL_LINES)}`);
			}
		}
	}
	return lines.join("\n");
}

/**
 * On Anthropic, the Prompt cache needs explicit breakpoints: the system prompt and the last
 * message of the history (the stable prefix the new prompt follows). Other vendors cache a
 * prefix by themselves, or not at all. The saved history never carries the markers.
 */
function withCacheMarkers(
	model: LanguageModel,
	system: string,
	history: ModelMessage[],
): {
	system:
		| string
		| { role: "system"; content: string; providerOptions: typeof ANTHROPIC_CACHE_BREAKPOINT };
	history: ModelMessage[];
} {
	if (!isAnthropicModel(model)) return { system, history };
	const last = history.at(-1);
	return {
		system: { role: "system", content: system, providerOptions: ANTHROPIC_CACHE_BREAKPOINT },
		history: last
			? [...history.slice(0, -1), { ...last, providerOptions: ANTHROPIC_CACHE_BREAKPOINT }]
			: history,
	};
}

/** The vendor's own words in an error body, for matching. */
function bodyOf(error: APICallError): string {
	return `${error.responseBody ?? ""} ${error.message}`.toLowerCase();
}

/**
 * The reason a vendor error stops a turn, in the chat's words, naming the Provider by its
 * label: the same sentences as the Claude adapter's. Never the request, so never a key.
 */
export function chatErrorText(label: string, error: unknown): string {
	const cause = RetryError.isInstance(error) ? error.lastError : error;
	if (UnsupportedFunctionalityError.isInstance(cause) && /tool/i.test(cause.functionality)) {
		return cannotCallTools(label);
	}
	if (APICallError.isInstance(cause)) {
		const status = cause.statusCode ?? 0;
		const body = bodyOf(cause);
		if (status === 402 || /insufficient_quota|billing|credit balance|payment required/.test(body)) {
			return `The ${label} account behind the ${label} Provider has a billing problem.`;
		}
		if (status === 401 || status === 403) {
			return `The ${label} Provider rejected its credentials. Check its API key in Settings → Providers.`;
		}
		if (status === 429) return `The ${label} Provider is rate limited. Try again in a moment.`;
		if (
			/tool|function call/.test(body) &&
			/support|unsupported|not available|not enabled/.test(body)
		) {
			return cannotCallTools(label);
		}
		if (
			status === 404 ||
			/model_not_found|model not found|unknown model|does not exist/.test(body)
		) {
			return `The chat model is not available to this ${label} account. Pick another one.`;
		}
		return `The ${label} Provider stopped the reply (${status || "no status"}): ${(cause.responseBody ?? cause.message).slice(0, 300)}`;
	}
	const message = cause instanceof Error ? cause.message : String(cause);
	return `The chat agent stopped: ${message}`;
}

function cannotCallTools(label: string): string {
	return `This ${label} model cannot call tools, which the Auto chat needs. Pick another model.`;
}

/** The mode's Yoqa tools as AI SDK tools; each call goes through the chat's `callTool`. */
function aiTools(turn: ChatTurn): ToolSet {
	const tools: ToolSet = {};
	for (const yoqaTool of turn.tools) {
		tools[yoqaTool.name] = tool({
			description: yoqaTool.description,
			inputSchema: z.object(yoqaTool.input),
			execute: (input: unknown) => turn.callTool(yoqaTool.name, input),
			toModelOutput: ({ output }: { output: { text: string; isError: boolean } }) => ({
				type: output.isError ? "error-text" : "text",
				value: output.text,
			}),
		});
	}
	return tools;
}

export function createAiSdkChatAgent(options: AiSdkChatAgentOptions = {}) {
	const maxToolSteps = options.maxToolSteps ?? MAX_TOOL_STEPS;
	const contextBudget = options.contextBudgetTokens ?? CONTEXT_BUDGET_TOKENS;
	const keepTurns = options.keepTurns ?? KEEP_TURNS;

	/**
	 * Compact `history` when it is over its share of the budget: the turns before the latest
	 * ones become one summary (with the summary before them), written by the same model in a
	 * call with no tools. The latest turns stay verbatim.
	 */
	async function compacted(
		history: ChatHistory,
		target: AiSdkChatTarget,
		signal: AbortSignal,
	): Promise<ChatHistory> {
		if (estimateTokens(history) <= contextBudget * COMPACT_AT_SHARE) return history;
		const turns = turnsOf(history.messages);
		if (turns.length <= keepTurns) return history;
		const older = turns.slice(0, turns.length - keepTurns);
		const prompt = [
			history.summary ? `Summary of the turns before these:\n${history.summary}\n` : "",
			"The turns to summarize:",
			transcriptOf(older.flat()),
		].join("\n");
		try {
			const { text } = await generateText({
				model: target.model,
				system: SUMMARY_SYSTEM,
				prompt,
				abortSignal: signal,
			});
			return {
				version: 1,
				summary: text.trim(),
				summarizedTurns: history.summarizedTurns + older.length,
				messages: turns.slice(turns.length - keepTurns).flat(),
			};
		} catch (error) {
			throw new Error(chatErrorText(target.label, error));
		}
	}

	async function* runTurn(turn: ChatTurn, target: AiSdkChatTarget): AsyncGenerator<ChatAgentEvent> {
		const resumed = parseHistory(turn.agentHistory);
		const history = await compacted(resumed, target, turn.signal);
		// Saved at once, so a turn that fails after it does not write the summary again.
		if (history !== resumed) yield { type: "agent_history", agentHistory: JSON.stringify(history) };
		// The conversation stands in for a history only when there is none.
		const prompt =
			history.messages.length === 0 && !history.summary
				? promptWithConversation(turn)
				: turn.prompt;
		const userMessage: ModelMessage = { role: "user", content: prompt };
		const cached = withCacheMarkers(
			target.model,
			systemWithSummary(turn.systemPrompt, history),
			history.messages,
		);
		const result = streamText({
			model: target.model,
			system: cached.system,
			messages: [...cached.history, userMessage],
			tools: aiTools(turn),
			stopWhen: isStepCount(maxToolSteps),
			abortSignal: turn.signal,
			onError: () => {},
		});
		let written = false;
		let newBlock = false;
		for await (const part of result.fullStream) {
			if (part.type === "error") throw new Error(chatErrorText(target.label, part.error));
			if (part.type === "abort") return;
			if (part.type === "text-start") newBlock = true;
			if (part.type === "text-delta" && part.text) {
				if (newBlock && written) yield { type: "text", delta: "\n\n" };
				newBlock = false;
				written = true;
				yield { type: "text", delta: part.text };
			}
		}
		const steps = await result.steps;
		const saved: ChatHistory = {
			...history,
			messages: [...history.messages, userMessage, ...(await result.responseMessages)],
		};
		yield { type: "agent_history", agentHistory: JSON.stringify(saved) };
		if (steps.length >= maxToolSteps && steps.at(-1)?.finishReason === "tool-calls") {
			throw new Error(
				`The agent stopped after ${maxToolSteps} tool steps without finishing its reply. Ask it to carry on, or narrow the request.`,
			);
		}
	}

	return { runTurn };
}
