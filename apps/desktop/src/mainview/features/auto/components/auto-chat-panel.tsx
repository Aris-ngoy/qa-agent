import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { AutoComposer } from "@/features/auto/components/auto-composer";
import {
	AutoMessageBubble,
	AutoQueuedBubble,
	AutoReplyBubble,
} from "@/features/auto/components/auto-message";
import { AutoRunCard } from "@/features/auto/components/auto-run-card";
import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import {
	useCreateAutoChat,
	useRemoveAutoQueuedMessage,
} from "@/features/auto/hooks/usequery/use-auto";
import { useFollowLatest } from "@/features/runs/hooks/use-follow-latest";
import { Button } from "@heroui/react";
import { useValue } from "@legendapp/state/react";
import { useNavigate } from "@tanstack/react-router";

/**
 * The left of Auto: the open chat's messages, its reply streaming in, the card of its Run of
 * the Case draft, the messages queued until that Run ends, and the composer.
 */
export function AutoChatPanel({
	appId,
	chatId,
	listLoading,
	listError,
}: {
	appId: string;
	chatId: string | null;
	listLoading: boolean;
	listError: string | null;
}) {
	if (!chatId) {
		if (listLoading) {
			return <p className="text-body-md text-on-surface-variant">Loading chats…</p>;
		}
		if (listError) return <p className="text-body-md text-error">{listError}</p>;
		return <StartChat appId={appId} />;
	}

	return (
		<section
			aria-label="Chat"
			className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius)] border border-outline-variant bg-surface-container-lowest"
		>
			<MessageList chatId={chatId} />
			<AutoComposer chatId={chatId} key={chatId} />
		</section>
	);
}

function MessageList({ chatId }: { chatId: string }) {
	const reducedMotion = useReducedMotion();
	const loadedId = useValue(shownAutoChat$.chat.id);
	const error = useValue(shownAutoChat$.error);
	const messages = useValue(shownAutoChat$.chat.messages) ?? [];
	const reply = useValue(shownAutoChat$.chat.reply) ?? null;
	const run = useValue(shownAutoChat$.chat.run) ?? null;
	const queue = useValue(shownAutoChat$.chat.queue) ?? [];
	const removeQueued = useRemoveAutoQueuedMessage();
	const loaded = loadedId === chatId;
	const follow = useFollowLatest(
		loaded,
		`${messages.length}:${reply?.text.length ?? -1}:${reply?.toolCalls.length ?? 0}:${run?.runId ?? ""}:${queue.length}`,
		!reducedMotion,
	);

	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
			onKeyDown={follow.onUserScroll}
			onPointerDown={follow.onUserScroll}
			onScroll={follow.onScroll}
			onTouchStart={follow.onUserScroll}
			onWheel={follow.onUserScroll}
			ref={follow.ref}
		>
			{!loaded ? (
				<p className="m-auto text-body-sm text-on-surface-variant">
					{error ? <span className="text-error">{error}</span> : "Loading chat…"}
				</p>
			) : messages.length === 0 && !reply ? (
				<div className="m-auto max-w-sm text-center">
					<p className="m-0 text-body-md font-medium text-on-surface">Ask about this App</p>
					<p className="m-0 mt-1 text-body-sm text-on-surface-variant">
						For example "Why did the last run of #8 fail?" Ask reads the Test Case and its Runs, and
						never touches the device.
					</p>
				</div>
			) : null}
			{loaded
				? messages.map((message) => <AutoMessageBubble key={message.id} message={message} />)
				: null}
			{loaded && reply ? <AutoReplyBubble reply={reply} /> : null}
			{loaded && run ? <AutoRunCard run={run} /> : null}
			{loaded
				? queue.map((queued) => (
						<AutoQueuedBubble
							key={queued.id}
							onRemove={
								removeQueued.isPending
									? null
									: () => removeQueued.mutate({ chatId, queuedId: queued.id })
							}
							queued={queued}
						/>
					))
				: null}
		</div>
	);
}

/** No chat yet on this App: start one. */
function StartChat({ appId }: { appId: string }) {
	const navigate = useNavigate();
	const createChat = useCreateAutoChat();
	return (
		<div className="motion-fade-up flex flex-1 items-center justify-center rounded-[var(--radius)] border border-outline-variant bg-surface-container-lowest px-6 py-12">
			<div className="flex max-w-sm flex-col items-center gap-3 text-center">
				<h2 className="m-0 text-subheading text-on-surface">Start a chat</h2>
				<p className="m-0 text-body-sm text-on-surface-variant">
					Ask the chat agent about this App's Test Cases and Runs. Open a Test Case and choose Chat
					about this case to start on it.
				</p>
				<Button
					className="rounded-lg bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90"
					isDisabled={createChat.isPending}
					onPress={() =>
						createChat.mutate(
							{ appId },
							{
								onSuccess: (chat) => void navigate({ to: "/auto", search: { chat: chat.id } }),
							},
						)
					}
				>
					New chat
				</Button>
			</div>
		</div>
	);
}
