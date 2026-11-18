import { useEnterOnce } from "@/app/motion/use-enter-once";
import { ResizeHandle } from "@/app/resize/resize-handle";
import { usePanelWidth } from "@/app/resize/use-panel-width";
import { useApps } from "@/features/apps/hooks/use-apps";
import { AutoChatPanel } from "@/features/auto/components/auto-chat-panel";
import { AutoHeader } from "@/features/auto/components/auto-header";
import { AutoSidePanel } from "@/features/auto/components/auto-side-panel";
import { AutoSignedOut } from "@/features/auto/components/auto-signed-out";
import { useAutoChatStream } from "@/features/auto/hooks/use-auto-chat-stream";
import { useAutoChats, useAutoStatus } from "@/features/auto/hooks/usequery/use-auto";
import { resolveOpenChatId } from "@/features/auto/utils/chat-list";
import { useSearch } from "@tanstack/react-router";
import { useRef } from "react";

/** The right panel opens at this width; the chat always keeps at least `CHAT_MIN_WIDTH`. */
const SIDE_PANEL_DEFAULT_WIDTH = 380;
const SIDE_PANEL_MIN_WIDTH = 300;
const CHAT_MIN_WIDTH = 380;
const HANDLE_WIDTH = 20;

/** Auto: chat with the chat agent about the current App, on the device already connected. */
export function AutoPage() {
	const { chat: requestedChatId } = useSearch({ from: "/auto" });
	const { selectedApp } = useApps();
	const status = useAutoStatus();

	if (!selectedApp) {
		return (
			<div className="motion-fade-up flex h-full items-center justify-center text-body-md text-on-surface-variant">
				Select an app to chat about it.
			</div>
		);
	}

	if (status.isLoading) {
		return <p className="px-4 text-body-md text-on-surface-variant">Checking Claude…</p>;
	}

	if (status.isError || !status.data) {
		return (
			<p className="px-4 text-body-md text-error">
				{status.error instanceof Error ? status.error.message : "Could not read Auto's status"}
			</p>
		);
	}

	if (!status.data.signedIn) {
		return <AutoSignedOut detail={status.data.detail} />;
	}

	return <AutoWorkspace appId={selectedApp.id} requestedChatId={requestedChatId} />;
}

function AutoWorkspace({
	appId,
	requestedChatId,
}: {
	appId: string;
	requestedChatId: string | undefined;
}) {
	const entered = useEnterOnce(true);
	const columnsRef = useRef<HTMLDivElement>(null);
	const sidePanel = usePanelWidth({
		storageKey: "yoqa.auto.sidePanelWidth",
		defaultWidth: SIDE_PANEL_DEFAULT_WIDTH,
		bounds: () => ({
			min: SIDE_PANEL_MIN_WIDTH,
			max:
				(columnsRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) -
				CHAT_MIN_WIDTH -
				HANDLE_WIDTH,
		}),
	});
	const chatsQuery = useAutoChats(appId);
	const chatId = resolveOpenChatId(requestedChatId, chatsQuery.data);
	useAutoChatStream(chatId);

	return (
		<div
			className={[
				"flex h-full min-h-0 flex-col gap-3 px-4 pb-4",
				entered ? "motion-enter-done" : "motion-enter",
			].join(" ")}
		>
			<AutoHeader
				appId={appId}
				chatId={chatId}
				chats={chatsQuery.data}
				requestedChatId={requestedChatId}
			/>
			<div ref={columnsRef} className="flex min-h-0 flex-1">
				<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
					<AutoChatPanel
						appId={appId}
						chatId={chatId}
						listLoading={chatsQuery.isLoading}
						listError={chatsQuery.error instanceof Error ? chatsQuery.error.message : null}
					/>
				</div>
				<ResizeHandle panel={sidePanel} edge="start" label="Resize side panel" className="w-5" />
				<div
					className="h-full min-h-0 shrink-0"
					style={{
						flexBasis: sidePanel.width,
						width: sidePanel.width,
						maxWidth: `calc(100% - ${CHAT_MIN_WIDTH + HANDLE_WIDTH}px)`,
						minWidth: SIDE_PANEL_MIN_WIDTH,
					}}
				>
					<AutoSidePanel />
				</div>
			</div>
		</div>
	);
}
