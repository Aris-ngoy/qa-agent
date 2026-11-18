import { isRunLive } from "@/features/auto/utils/run-card";
import {
	type AutoChat,
	type AutoChatEvent,
	type AutoChatSummary,
	type AutoMessage,
	type AutoReply,
	autoChatEventSchema,
} from "@yoqa/runner-client";

const EMPTY_REPLY: AutoReply = { text: "", toolCalls: [] };

/** One `data:` line of a chat's SSE stream; null when it is not an Auto chat event. */
export function parseAutoChatEvent(data: string): AutoChatEvent | null {
	try {
		const parsed = autoChatEventSchema.safeParse(JSON.parse(data));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/**
 * The chat as the picker lists it, without its messages, in-flight reply, Case draft, proposed
 * Test Case, Run, its Test Case's previous version and its queue.
 */
export function summaryOf(chat: AutoChat): AutoChatSummary {
	const {
		messages: _messages,
		reply: _reply,
		draft: _draft,
		proposal: _proposal,
		run: _run,
		previousVersion: _previousVersion,
		queue: _queue,
		...summary
	} = chat;
	return summary;
}

/**
 * The chat after one stream event, as a new object. Saved messages and tool calls are keyed by
 * id, so the same message arriving twice (the stream and the POST that sent it) shows once.
 */
export function applyAutoChatEvent(chat: AutoChat, event: AutoChatEvent): AutoChat {
	switch (event.type) {
		case "message":
			return applyMessage(chat, event.message);
		case "text": {
			const reply = chat.reply ?? EMPTY_REPLY;
			return { ...chat, reply: { ...reply, text: reply.text + event.delta } };
		}
		case "tool_call": {
			const reply = chat.reply ?? EMPTY_REPLY;
			if (reply.toolCalls.some((call) => call.id === event.call.id)) return chat;
			const call = { ...event.call, output: null, isError: false };
			return { ...chat, reply: { ...reply, toolCalls: [...reply.toolCalls, call] } };
		}
		case "tool_result": {
			const reply = chat.reply;
			if (!reply?.toolCalls.some((call) => call.id === event.id)) return chat;
			const toolCalls = reply.toolCalls.map((call) =>
				call.id === event.id ? { ...call, output: event.output, isError: event.isError } : call,
			);
			return { ...chat, reply: { ...reply, toolCalls } };
		}
		case "chat":
			return event.chat.id === chat.id ? { ...chat, ...event.chat } : chat;
		case "draft":
			return { ...chat, draft: event.draft };
		case "proposal":
			return { ...chat, proposal: event.proposal };
		case "run":
			return { ...chat, run: event.run };
		case "previous_version":
			return { ...chat, previousVersion: event.previousVersion };
		case "queue":
			return { ...chat, queue: event.queue };
	}
}

/**
 * A saved message: the user's prompt starts the reply being written, the agent's saved reply
 * takes the place of the in-flight one. A new prompt also clears the card of a Run that ended.
 */
function applyMessage(chat: AutoChat, message: AutoMessage): AutoChat {
	if (message.chatId !== chat.id) return chat;
	const known = chat.messages.some((row) => row.id === message.id);
	const messages = known
		? chat.messages.map((row) => (row.id === message.id ? message : row))
		: [...chat.messages, message];
	const reply =
		message.role === "assistant" ? null : known ? chat.reply : (chat.reply ?? EMPTY_REPLY);
	const run =
		message.role === "user" && !known && chat.run && !isRunLive(chat.run) ? null : chat.run;
	return {
		...chat,
		messages,
		reply,
		run,
		updatedAt: Math.max(chat.updatedAt, message.createdAt),
	};
}
