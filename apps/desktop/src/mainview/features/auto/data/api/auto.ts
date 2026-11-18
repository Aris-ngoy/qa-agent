import { getRunnerClient } from "@/app/runner-client";
import type {
	AutoChat,
	AutoChatSummary,
	AutoRunControl,
	AutoStatus,
	ListAutoModelsResponse,
	SendAutoMessageRequest,
	SendAutoMessageResponse,
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

/**
 * Send a message; the runner saves it and answers, and the reply streams on the chat's events.
 * While the chat's Run is live, the runner queues it instead.
 */
export async function sendAutoMessage(
	chatId: string,
	request: SendAutoMessageRequest,
): Promise<SendAutoMessageResponse> {
	const client = await getRunnerClient();
	return client.sendAutoMessage(chatId, request);
}

/** ✕ on a queued message: take it back before it is sent. */
export async function removeAutoQueuedMessage(chatId: string, queuedId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.removeAutoQueuedMessage(chatId, queuedId);
}

/** Stop the chat's Run of its Case draft, through the Run's own cancel. */
export async function stopAutoRun(chatId: string): Promise<void> {
	const client = await getRunnerClient();
	await client.stopAutoRun(chatId);
}

/** Pause, take over or resume the chat's Run of its Case draft, from the Run card. */
export async function controlAutoRun(chatId: string, control: AutoRunControl): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.controlAutoRun(chatId, control);
}

/** ✕ in the Test tab: remove one step from the Case draft; the draft must pass again. */
export async function removeAutoDraftStep(chatId: string, stepId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.removeAutoDraftStep(chatId, stepId);
}

/** Reject all: throw the Case draft away. */
export async function rejectAutoDraft(chatId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.rejectAutoDraft(chatId);
}

/** Apply the Case draft to its Test Case; refused until a Run of the whole draft passed. */
export async function applyAutoDraft(chatId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.applyAutoDraft(chatId);
}

/** Put back the Test Case's previous steps and Case Script. */
export async function restoreAutoPreviousVersion(chatId: string): Promise<AutoChat> {
	const client = await getRunnerClient();
	return client.restoreAutoPreviousVersion(chatId);
}

/** The chat's SSE stream URL, for an `EventSource`. */
export async function autoChatEventsUrl(chatId: string): Promise<string> {
	const client = await getRunnerClient();
	return client.getAutoChatEventsUrl(chatId);
}
