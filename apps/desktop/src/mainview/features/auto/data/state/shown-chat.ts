import { applyAutoChatEvent } from "@/features/auto/utils/chat-events";
import { observable } from "@legendapp/state";
import type { AutoChat, AutoChatEvent } from "@yoqa/runner-client";

/**
 * The Auto chat on screen: fetched once, then kept current by its SSE stream
 * (`useAutoChatStream`). Each change sets a whole new chat, so the list and the reply that
 * read it re-render.
 */
export type ShownAutoChat = {
	/** The chat `/auto` opened; null when there is none ("Start a chat"). */
	chatId: string | null;
	/** Null until it loads. */
	chat: AutoChat | null;
	/** Why it could not load. */
	error: string | null;
};

export const shownAutoChat$ = observable<ShownAutoChat>({ chatId: null, chat: null, error: null });

/** Open `chatId`; the same chat stays as it is (a reconnect refetches it in place). */
export function openShownChat(chatId: string | null): void {
	if (shownAutoChat$.chatId.peek() === chatId) return;
	shownAutoChat$.set({ chatId, chat: null, error: null });
}

/** The fetched chat, unless another one was opened meanwhile. */
export function showLoadedChat(chat: AutoChat): void {
	if (shownAutoChat$.chatId.peek() !== chat.id) return;
	shownAutoChat$.set({ chatId: chat.id, chat, error: null });
}

export function showChatError(chatId: string, error: string): void {
	if (shownAutoChat$.chatId.peek() !== chatId) return;
	shownAutoChat$.error.set(error);
}

/**
 * Apply one event to the shown chat. Events for another chat, or that arrive before the chat
 * has loaded, are dropped: the stream has no replay, so the fetch is the starting point, and a
 * text delta lost in that gap shows once the saved reply replaces the in-flight one.
 */
export function applyToShownChat(chatId: string, event: AutoChatEvent): void {
	const chat = shownAutoChat$.chat.peek();
	if (!chat || chat.id !== chatId) return;
	shownAutoChat$.chat.set(applyAutoChatEvent(chat, event));
}
