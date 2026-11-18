import { showErrorToast } from "@/app/show-error-toast";
import {
	applyAutoDraft,
	controlAutoRun,
	createAutoChat,
	deleteAutoChat,
	getAutoStatus,
	listAutoChats,
	listAutoModels,
	rejectAutoDraft,
	removeAutoDraftStep,
	restoreAutoPreviousVersion,
	sendAutoMessage,
	setAutoChatModel,
	stopAutoRun,
} from "@/features/auto/data/api/auto";
import { applyToShownChat } from "@/features/auto/data/state/shown-chat";
import { summaryOf } from "@/features/auto/utils/chat-events";
import { removeChatSummary, upsertChatSummary } from "@/features/auto/utils/chat-list";
import { caseQueryKey, casesQueryKey } from "@/features/test-cases/hooks/usequery/use-cases";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoChat, AutoChatMode, AutoChatSummary, AutoRunControl } from "@yoqa/runner-client";

export const autoStatusQueryKey = ["auto", "status"] as const;
export const autoModelsQueryKey = ["auto", "models"] as const;

export function autoChatsQueryKey(appId: string) {
	return ["auto", "chats", appId] as const;
}

/** Put `chat` in its App's chat list, if that list is loaded. */
export function cacheChatSummary(queryClient: QueryClient, chat: AutoChatSummary): void {
	queryClient.setQueryData<AutoChatSummary[]>(autoChatsQueryKey(chat.appId), (current) =>
		current ? upsertChatSummary(current, chat) : current,
	);
}

/** Whether the Claude Provider is signed in; Auto has no other agent. */
export function useAutoStatus() {
	return useQuery({ queryKey: autoStatusQueryKey, queryFn: getAutoStatus });
}

/** The Claude Provider's chat models, for the composer's picker. */
export function useAutoModels() {
	return useQuery({
		queryKey: autoModelsQueryKey,
		queryFn: listAutoModels,
		staleTime: 5 * 60_000,
	});
}

/** The App's chats, for the chat picker. */
export function useAutoChats(appId: string) {
	return useQuery({ queryKey: autoChatsQueryKey(appId), queryFn: () => listAutoChats(appId) });
}

/** Start a chat (on a Test Case with `caseId`) and add it to its App's list. */
export function useCreateAutoChat() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ appId, caseId }: { appId: string; caseId?: string }) =>
			createAutoChat(appId, caseId),
		onSuccess: (chat) => cacheChatSummary(queryClient, summaryOf(chat)),
		onError: (error) => showErrorToast(error, "Failed to start a chat"),
	});
}

export function useDeleteAutoChat() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (chat: AutoChatSummary) => {
			await deleteAutoChat(chat.id);
			return chat;
		},
		onSuccess: (chat) => {
			queryClient.setQueryData<AutoChatSummary[]>(autoChatsQueryKey(chat.appId), (current) =>
				current ? removeChatSummary(current, chat.id) : current,
			);
		},
		onError: (error) => showErrorToast(error, "Failed to delete the chat"),
	});
}

/** Pick the chat's model (null for the default); the header and the picker follow. */
export function useSetAutoChatModel() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ chatId, model }: { chatId: string; model: string | null }) =>
			setAutoChatModel(chatId, model),
		onSuccess: (chat) => {
			const summary = summaryOf(chat);
			applyToShownChat(chat.id, { type: "chat", chat: summary });
			cacheChatSummary(queryClient, summary);
		},
		onError: (error) => showErrorToast(error, "Failed to change the model"),
	});
}

/**
 * Send a message. The saved prompt shows at once (the stream sends it too; it shows once) and
 * the reply streams in. A refusal (not signed in, a reply already being written) is a toast,
 * and the sign-in status is read again.
 */
export function useSendAutoMessage() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ chatId, text, mode }: { chatId: string; text: string; mode: AutoChatMode }) =>
			sendAutoMessage(chatId, { text, mode }),
		onSuccess: (message) => applyToShownChat(message.chatId, { type: "message", message }),
		onError: (error) => {
			showErrorToast(error, "Failed to send the message");
			void queryClient.invalidateQueries({ queryKey: autoStatusQueryKey });
		},
	});
}

/** Stop the chat's Run (Stop, Esc); its Run card shows it stopped once the stream says so. */
export function useStopAutoRun() {
	return useMutation({
		mutationFn: (chatId: string) => stopAutoRun(chatId),
		onError: (error) => showErrorToast(error, "Failed to stop the run"),
	});
}

/** Pause, Take over or Resume from the Run card; the Run card shows what the runner answered. */
export function useControlAutoRun() {
	return useMutation({
		mutationFn: ({ chatId, control }: { chatId: string; control: AutoRunControl }) =>
			controlAutoRun(chatId, control),
		onSuccess: (chat) => {
			if (chat.run) applyToShownChat(chat.id, { type: "run", run: chat.run });
		},
		onError: (error) => showErrorToast(error, "Run control failed"),
	});
}

/** Show the Case draft and previous version a Test tab action answered with (the stream says so too). */
function showDraftOf(chat: AutoChat): void {
	applyToShownChat(chat.id, { type: "draft", draft: chat.draft });
	applyToShownChat(chat.id, { type: "previous_version", previousVersion: chat.previousVersion });
}

/** The chat's Test Case changed in the catalog: Test Cases reads it again. */
function refetchChatCase(queryClient: QueryClient, chat: AutoChat): void {
	void queryClient.invalidateQueries({ queryKey: casesQueryKey(chat.appId) });
	if (chat.caseId) void queryClient.invalidateQueries({ queryKey: caseQueryKey(chat.caseId) });
}

/** ✕ on a draft step: remove it; Apply turns off until the draft passes again. */
export function useRemoveAutoDraftStep() {
	return useMutation({
		mutationFn: ({ chatId, stepId }: { chatId: string; stepId: string }) =>
			removeAutoDraftStep(chatId, stepId),
		onSuccess: showDraftOf,
		onError: (error) => showErrorToast(error, "Failed to remove the step"),
	});
}

/** Reject all: throw the Case draft away. */
export function useRejectAutoDraft() {
	return useMutation({
		mutationFn: (chatId: string) => rejectAutoDraft(chatId),
		onSuccess: showDraftOf,
		onError: (error) => showErrorToast(error, "Failed to reject the draft"),
	});
}

/** Apply the Case draft to its Test Case; a refusal says why in a toast. */
export function useApplyAutoDraft() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (chatId: string) => applyAutoDraft(chatId),
		onSuccess: (chat) => {
			showDraftOf(chat);
			refetchChatCase(queryClient, chat);
		},
		onError: (error) => showErrorToast(error, "Failed to apply the draft"),
	});
}

/** Restore previous version: swap the Test Case's current and previous steps and Case Script. */
export function useRestoreAutoPreviousVersion() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (chatId: string) => restoreAutoPreviousVersion(chatId),
		onSuccess: (chat) => {
			showDraftOf(chat);
			refetchChatCase(queryClient, chat);
		},
		onError: (error) => showErrorToast(error, "Failed to restore the previous version"),
	});
}
