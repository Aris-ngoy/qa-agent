import { getRunnerClient } from "@/app/runner-client";
import type {
	AutoChat,
	AutoChatSummary,
	AutoMessage,
	AutoStatus,
	ListAutoModelsResponse,
	SendAutoMessageRequest,
} from "@yoqa/runner-client";

export async function getAutoStatus(): Promise<AutoStatus> {
	const client = await getRunnerClient();
	return client.getAutoStatus();
}

export async function listAutoModels(): Promise<ListAutoModelsResponse> {
	const client = await getRunnerClient();
	return client.listAutoModels();
}

export async function listAutoChats(appId: string): Promise<AutoChatSummary[]> {
	const client = await getRunnerClient();
	return client.listAutoChats(appId);
}

/** A new chat on `appId`; with `caseId`, "Chat about this case" starts it on that Test Case. */
export async function createAutoChat(appId: string, caseId?: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.createAutoChat(appId, caseId ? { caseId } : {});
}

export async function getAutoChat(chatId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.getAutoChat(chatId);
}

/** Set the chat model; null goes back to the Claude Provider's default. */
export async function setAutoChatModel(chatId: string, model: string | null): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.updateAutoChat(chatId, { model });
}

export async function deleteAutoChat(chatId: string): Promise<void> {
	const client = await getRunnerClient();
	await client.deleteAutoChat(chatId);
}

/** Send a message; the runner saves it and answers, and the reply streams on the chat's events. */
export async function sendAutoMessage(
	chatId: string,
	request: SendAutoMessageRequest,
): Promise<AutoMessage> {
	const client = await getRunnerClient();
	return client.sendAutoMessage(chatId, request);
}

/** Stop the chat's Run of its Case draft, through the Run's own cancel. */
export async function stopAutoRun(chatId: string): Promise<void> {
	const client = await getRunnerClient();
	await client.stopAutoRun(chatId);
}

/** The chat's SSE stream URL, for an `EventSource`. */
export async function autoChatEventsUrl(chatId: string): Promise<string> {
	const client = await getRunnerClient();
	return client.getAutoChatEventsUrl(chatId);
}
