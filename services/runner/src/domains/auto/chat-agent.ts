import type { AutoChatMode, AutoStatus, ListAutoModelsResponse } from "@yoqa/runner-client";
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
	/** The chat model; null for the Claude Provider's default. */
	model: string | null;
	/** The chat agent's session to resume; null on the chat's first message. */
	agentSessionId: string | null;
	systemPrompt: string;
	/** The tools the mode allows. */
	tools: ChatTool[];
	/** Call a Yoqa tool by name. One the mode does not allow is refused, whoever asks. */
	callTool: (name: string, input: unknown) => Promise<ChatToolOutput>;
	signal: AbortSignal;
};

/** What the chat agent reports while it answers a turn. Tool calls are reported by `callTool`. */
export type ChatAgentEvent =
	| { type: "agent_session"; agentSessionId: string }
	| { type: "text"; delta: string };

/** The chat agent behind Auto: the Claude Agent SDK in production, a scripted one in tests. */
export type ChatAgent = {
	status: () => Promise<AutoStatus>;
	models: () => Promise<ListAutoModelsResponse>;
	/** Answer one turn. Throws when the turn cannot be answered (the error is shown in the chat). */
	runTurn: (turn: ChatTurn) => AsyncIterable<ChatAgentEvent>;
};
