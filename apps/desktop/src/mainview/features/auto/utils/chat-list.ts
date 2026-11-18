import type { AutoChatSummary } from "@yoqa/runner-client";

/** The chat picker's order: the chat touched last first. */
export function sortChatsNewestFirst(chats: AutoChatSummary[]): AutoChatSummary[] {
	return [...chats].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** `chats` with `chat` in it, replacing the one with its id, newest first. */
export function upsertChatSummary(
	chats: AutoChatSummary[],
	chat: AutoChatSummary,
): AutoChatSummary[] {
	return sortChatsNewestFirst([...chats.filter((row) => row.id !== chat.id), chat]);
}

export function removeChatSummary(chats: AutoChatSummary[], chatId: string): AutoChatSummary[] {
	return chats.filter((row) => row.id !== chatId);
}

/**
 * The chat `/auto` shows: the one its `chat` search param names, else the App's newest, else
 * none ("Start a chat"). A named chat the App's list does not have (another App's, or deleted)
 * gives way to the newest once the list has loaded; until then it opens as named.
 */
export function resolveOpenChatId(
	requested: string | undefined,
	chats: AutoChatSummary[] | undefined,
): string | null {
	if (!chats) return requested ?? null;
	if (requested && chats.some((chat) => chat.id === requested)) return requested;
	return sortChatsNewestFirst(chats)[0]?.id ?? null;
}
