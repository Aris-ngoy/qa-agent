import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import { useCreateAutoChat, useDeleteAutoChat } from "@/features/auto/hooks/usequery/use-auto";
import { chatCaseLabel, chatTitle } from "@/features/auto/utils/chat-labels";
import { sortChatsNewestFirst } from "@/features/auto/utils/chat-list";
import { TrashIcon } from "@/features/test-cases/components/case-icons";
import { Button, Dropdown, Label } from "@heroui/react";
import { useValue } from "@legendapp/state/react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { AutoChatSummary } from "@yoqa/runner-client";
import { useMemo } from "react";

function ChevronIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0 text-outline"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
		>
			<path d="M8 9l4-4 4 4M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

/**
 * The Auto header: the chat picker (the App's chats, newest first), New chat, delete, and the
 * chat's Test Case. The platform and device pickers are the top bar's: Auto uses the device
 * already connected there and never connects or switches one itself.
 */
export function AutoHeader({
	appId,
	chatId,
	chats,
	requestedChatId,
}: {
	appId: string;
	chatId: string | null;
	chats: AutoChatSummary[] | undefined;
	requestedChatId: string | undefined;
}) {
	const navigate = useNavigate();
	const createChat = useCreateAutoChat();
	const deleteChat = useDeleteAutoChat();
	const sorted = useMemo(() => sortChatsNewestFirst(chats ?? []), [chats]);
	const listed = sorted.find((chat) => chat.id === chatId) ?? null;

	// The shown chat is the freshest (its stream renames it and sets its Test Case).
	const shownId = useValue(shownAutoChat$.chat.id);
	const shownTitle = useValue(shownAutoChat$.chat.title);
	const shownCaseId = useValue(shownAutoChat$.chat.caseId);
	const shownCaseNumber = useValue(shownAutoChat$.chat.caseNumber);
	const shownCaseName = useValue(shownAutoChat$.chat.caseName);
	const shown =
		shownId === chatId && shownId != null
			? {
					title: shownTitle ?? "",
					caseId: shownCaseId ?? null,
					caseNumber: shownCaseNumber ?? null,
					caseName: shownCaseName ?? null,
				}
			: listed;
	const caseLabel = shown ? chatCaseLabel(shown) : null;

	const openChat = (id: string | null) => {
		void navigate({ to: "/auto", search: id ? { chat: id } : {} });
	};

	const startChat = () => {
		createChat.mutate({ appId }, { onSuccess: (chat) => openChat(chat.id) });
	};

	const deleteShown = () => {
		if (!listed) return;
		deleteChat.mutate(listed, {
			onSuccess: (deleted) => {
				// The newest of the rest opens in its place.
				if (requestedChatId === deleted.id) openChat(null);
			},
		});
	};

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2">
			<Dropdown>
				<Button
					aria-label="Chats"
					className="h-9 min-w-48 max-w-80 justify-between gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-sm font-medium text-on-surface shadow-none"
					isDisabled={sorted.length === 0}
					variant="ghost"
				>
					<span className="truncate">{shown ? chatTitle(shown) : "No chats yet"}</span>
					<ChevronIcon />
				</Button>
				<Dropdown.Popover className="w-80">
					<Dropdown.Menu
						onAction={(key) => openChat(String(key))}
						selectedKeys={chatId ? new Set([chatId]) : new Set()}
						selectionMode="single"
					>
						{sorted.map((chat) => {
							const label = chatCaseLabel(chat);
							return (
								<Dropdown.Item id={chat.id} key={chat.id} textValue={chatTitle(chat)}>
									<span className="flex min-w-0 flex-col">
										<Label className="truncate">{chatTitle(chat)}</Label>
										{label ? (
											<span className="truncate text-helper text-on-surface-variant">{label}</span>
										) : null}
									</span>
								</Dropdown.Item>
							);
						})}
					</Dropdown.Menu>
				</Dropdown.Popover>
			</Dropdown>

			<Button
				aria-label="Delete this chat"
				className="size-9 min-w-9 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
				isDisabled={!listed || deleteChat.isPending}
				onPress={deleteShown}
				variant="ghost"
			>
				<TrashIcon />
			</Button>

			<Button
				className="h-9 gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-sm font-semibold text-on-surface shadow-none data-[hovered=true]:bg-surface-container"
				isDisabled={createChat.isPending}
				onPress={startChat}
				variant="ghost"
			>
				<PlusIcon />
				New chat
			</Button>

			{shown?.caseId && caseLabel ? (
				<Link
					className="ml-2 inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-body-sm font-medium text-on-surface hover:bg-surface-container-high"
					params={{ caseId: shown.caseId }}
					title="Open the Test Case"
					to="/test-cases/$caseId"
				>
					<span className="text-helper text-outline">Test Case</span>
					<span className="truncate">{caseLabel}</span>
				</Link>
			) : null}
		</div>
	);
}
