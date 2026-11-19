import type {
	AutoChatMode,
	AutoChatProvider,
	AutoStatus,
	ListAutoModelsResponse,
} from "@yoqa/runner-client";
import type { ZodRawShape, z } from "zod";

/** What a Yoqa tool answers: text for the chat agent, flagged when the call did not do its job. */
export type ChatToolOutput = { text: string; isError: boolean };

/**
 * A Yoqa tool the chat agent may call, in the modes that allow it. Tools answer in text:
 * the chat agent never sees a screenshot.
 */
export type ChatTool<Shape extends ZodRawShape = ZodRawShape> = {
	name: string;
	description: string;
	modes: AutoChatMode[];
	input: Shape;
	run: (input: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<ChatToolOutput>;
};

/** One turn of an Auto chat: the user's message, in its mode, for the chat agent to answer. */
export type ChatTurn = {
	chatId: string;
	prompt: string;
	mode: AutoChatMode;
	/** The chat's Provider, which answers the turn; null when the chat has none. */
	providerId: string | null;
	/** The chat model; null for the Provider's default. */
	model: string | null;
	/** The Claude Agent SDK session to resume; null when there is none. */
	agentSessionId: string | null;
	/** The AI SDK chat agent's history to go on from (its own JSON); null when there is none. */
	agentHistory: string | null;
	/**
	 * The chat's visible conversation so far, as plain text (the user's prompts and the reply
	 * texts, each tool call on one line). Set only when the agent has nothing of its own to
	 * resume but the chat has messages, as after a switch of Provider.
	 */
	conversation: string | null;
	systemPrompt: string;
	/** The tools the mode allows. */
	tools: ChatTool[];
	/** Call a Yoqa tool by name. One the mode does not allow is refused, whoever asks. */
	callTool: (name: string, input: unknown) => Promise<ChatToolOutput>;
	signal: AbortSignal;
};

/**
 * What the chat agent reports while it answers a turn. Tool calls are reported by `callTool`.
 * `agent_session` and `agent_history` are what the agent resumes from next turn, saved with
 * the chat: the Claude Agent SDK's session, or the AI SDK agent's history.
 */
export type ChatAgentEvent =
	| { type: "agent_session"; agentSessionId: string }
	| { type: "agent_history"; agentHistory: string }
	| { type: "text"; delta: string };

/**
 * A Chat-capable Provider as the chat sees it now, without its models: whether it can answer,
 * and why not. Cheap to read (no vendor call).
 */
export type ChatProvider = Omit<AutoChatProvider, "models">;

/**
 * The chat agent behind Auto: in production one that routes each turn to the chat's Provider
 * (the Claude Agent SDK for the Claude Provider, the AI SDK agent for every other); in tests
 * one with scripted turns.
 */
export type ChatAgent = {
	/** Signed in when any Chat-capable Provider is. */
	status: () => Promise<AutoStatus>;
	/** Every Chat-capable Provider with its models, and the Provider a new chat starts on. */
	models: () => Promise<ListAutoModelsResponse>;
	/** The Chat-capable Providers and the one a new chat starts on, without their models. */
	providers: () => Promise<{ providers: ChatProvider[]; defaultProviderId: string | null }>;
	/** Answer one turn. Throws when the turn cannot be answered (the error is shown in the chat). */
	runTurn: (turn: ChatTurn) => AsyncIterable<ChatAgentEvent>;
};

/** The prompt to send for `turn`: led by the chat's conversation so far, when the turn carries it. */
export function promptWithConversation(turn: Pick<ChatTurn, "prompt" | "conversation">): string {
	if (!turn.conversation) return turn.prompt;
	return [
		"This chat began with another agent. The conversation so far, for context (read anything you need again with the Yoqa tools):",
		"<conversation>",
		turn.conversation,
		"</conversation>",
		"",
		turn.prompt,
	].join("\n");
}
