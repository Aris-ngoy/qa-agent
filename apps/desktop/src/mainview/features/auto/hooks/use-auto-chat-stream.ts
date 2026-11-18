import { logDevError } from "@/app/show-error-toast";
import { autoChatEventsUrl, getAutoChat } from "@/features/auto/data/api/auto";
import {
	applyToShownChat,
	openShownChat,
	showChatError,
	showLoadedChat,
} from "@/features/auto/data/state/shown-chat";
import { cacheChatSummary } from "@/features/auto/hooks/usequery/use-auto";
import { parseAutoChatEvent } from "@/features/auto/utils/chat-events";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** How long to wait before opening a stream the browser gave up on again. */
const REOPEN_DELAY_MS = 2000;

/**
 * Show `chatId` and keep it live: open its SSE stream, fetch the chat each time the stream
 * (re)connects, since the stream has no replay, then apply its events to `shownAutoChat$`.
 * A `chat` event also updates the chat picker.
 */
export function useAutoChatStream(chatId: string | null): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		openShownChat(chatId);
		if (!chatId) return;

		let cancelled = false;
		let source: EventSource | null = null;
		let reopenTimer: ReturnType<typeof setTimeout> | null = null;

		/** Fetch the chat; false when it could not be loaded (gone, or the runner is down). */
		const load = async (): Promise<boolean> => {
			try {
				const chat = await getAutoChat(chatId);
				if (!cancelled) showLoadedChat(chat);
				return true;
			} catch (error) {
				if (cancelled) return false;
				logDevError("Could not load the chat", error);
				showChatError(chatId, error instanceof Error ? error.message : "Could not load the chat");
				return false;
			}
		};

		const open = (url: string) => {
			if (cancelled) return;
			source = new EventSource(url);
			source.onopen = () => {
				void load();
			};
			source.onmessage = (message: MessageEvent<string>) => {
				const event = parseAutoChatEvent(message.data);
				if (!event) return;
				applyToShownChat(chatId, event);
				if (event.type === "chat") cacheChatSummary(queryClient, event.chat);
			};
			// The browser reconnects by itself, and `onopen` then fetches the chat again. When it
			// gives up instead (the stream answered with an error), open it again while the chat
			// still loads.
			source.onerror = () => {
				if (source?.readyState !== EventSource.CLOSED) return;
				void load().then((loaded) => {
					if (!loaded || cancelled) return;
					reopenTimer = setTimeout(() => open(url), REOPEN_DELAY_MS);
				});
			};
		};

		void autoChatEventsUrl(chatId).then(open, (error: unknown) => {
			if (cancelled) return;
			logDevError("Could not open the chat stream", error);
			void load();
		});

		return () => {
			cancelled = true;
			if (reopenTimer) clearTimeout(reopenTimer);
			source?.close();
		};
	}, [chatId, queryClient]);
}
