import { rm } from "node:fs/promises";
import type {
	AutoChat,
	AutoChatEvent,
	AutoChatMode,
	AutoChatSummary,
	AutoMessage,
	AutoQueuedMessage,
	AutoReply,
	AutoRunControl,
	AutoToolCall,
	CaseDraft,
	CatalogCase,
	CreateAutoChatRequest,
	SendAutoMessageRequest,
	SendAutoMessageResponse,
	UpdateAutoChatRequest,
} from "@yoqa/runner-client";
import { autoToolCallSchema, caseDraftSchema } from "@yoqa/runner-client";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import {
	type CatalogTx,
	caseStepsIn,
	getApp,
	getCase,
	getCasePreviousVersion,
	replaceCaseVersion,
	restoreCasePreviousVersion,
} from "../catalog/application";
import { getCatalogDb } from "../catalog/db";
import { caseEditedSince, removeStep } from "./case-draft";
import type { ChatAgent, ChatToolOutput } from "./chat-agent";
import { autoChatDir } from "./chat-dir";
import {
	chatRunInProgress,
	controlChatRun,
	currentChatRun,
	runChatDraft,
	stopChatRun,
} from "./chat-runs";
import { autoCaseDrafts, autoChats, autoMessages } from "./schema";
import { type ChatDraftRun, MODE_LABEL, callChatTool, chatTools } from "./tools";

export class AutoNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AutoNotFoundError";
	}
}

export class AutoValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AutoValidationError";
	}
}

/** The request is fine, but the chat cannot take it now (a reply is being written, not signed in). */
export class AutoConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AutoConflictError";
	}
}

const NEW_CHAT_TITLE = "New chat";
/** The reason a saved step removed with ✕ in the Test tab shows. */
const REMOVED_IN_TEST_TAB = "Removed in the Test tab";
const TITLE_LENGTH = 60;
/** The modes from the narrowest (fewest tools) to the widest. */
const MODES_NARROWEST_FIRST: AutoChatMode[] = ["ask", "run", "explore"];

type ChatRow = typeof autoChats.$inferSelect;
type MessageRow = typeof autoMessages.$inferSelect;

/** A reply being written: what the chat shows of it so far, and how to stop it. */
type ActiveTurn = { reply: AutoReply; abort: AbortController };

/** Someone following a chat's events, told when the chat is gone. */
type ChatListener = { event: (event: AutoChatEvent) => void; closed: () => void };

const activeTurns = new Map<string, ActiveTurn>();
const listeners = new Map<string, Set<ChatListener>>();
/** Each chat's messages queued until its Run ends, in order; a chat with none has no entry. */
const queues = new Map<string, AutoQueuedMessage[]>();

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

function publish(chatId: string, event: AutoChatEvent): void {
	for (const listener of listeners.get(chatId) ?? []) listener.event(event);
}

/**
 * Listen to a chat's events until the returned function is called; `closed` is called
 * instead when the chat is deleted.
 */
export function subscribeToChat(chatId: string, listener: ChatListener): () => void {
	const set = listeners.get(chatId) ?? new Set();
	set.add(listener);
	listeners.set(chatId, set);
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(chatId);
	};
}

function parseToolCalls(raw: string): AutoToolCall[] {
	try {
		return z.array(autoToolCallSchema).parse(JSON.parse(raw));
	} catch {
		return [];
	}
}

function messageFromRow(row: MessageRow): AutoMessage {
	const mode = row.mode === "ask" || row.mode === "run" || row.mode === "explore" ? row.mode : null;
	return {
		id: row.id,
		chatId: row.chatId,
		role: row.role === "user" ? "user" : "assistant",
		mode,
		text: row.text,
		toolCalls: parseToolCalls(row.toolCallsJson),
		error: row.error,
		createdAt: row.createdAt,
	};
}

async function summaryFromRow(row: ChatRow): Promise<AutoChatSummary> {
	const catalogCase = row.caseId ? await getCase(row.caseId) : null;
	return {
		id: row.id,
		appId: row.appId,
		caseId: catalogCase?.id ?? null,
		caseNumber: catalogCase?.number ?? null,
		caseName: catalogCase?.name ?? null,
		title: row.title,
		model: row.model,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function chatRow(chatId: string): Promise<ChatRow> {
	const row = await getCatalogDb().query.autoChats.findFirst({ where: eq(autoChats.id, chatId) });
	if (!row) throw new AutoNotFoundError("Chat not found");
	return row;
}

async function chatSummary(chatId: string): Promise<AutoChatSummary> {
	return summaryFromRow(await chatRow(chatId));
}

export async function getChat(chatId: string): Promise<AutoChat> {
	const summary = await chatSummary(chatId);
	const rows = await getCatalogDb()
		.select()
		.from(autoMessages)
		.where(eq(autoMessages.chatId, chatId))
		.orderBy(asc(autoMessages.seq));
	return {
		...summary,
		messages: rows.map(messageFromRow),
		reply: activeTurns.get(chatId)?.reply ?? null,
		draft: await readDraft(chatId, summary.caseId),
		run: currentChatRun(chatId),
		previousVersion: summary.caseId ? await getCasePreviousVersion(summary.caseId) : null,
		queue: queues.get(chatId) ?? [],
	};
}

function parseDraft(raw: string): CaseDraft | null {
	const parsed = caseDraftSchema.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data : null;
}

/** The chat's Case draft of `caseId`, its Test Case; null when it has none. */
async function readDraft(chatId: string, caseId: string | null): Promise<CaseDraft | null> {
	if (!caseId) return null;
	const row = await getCatalogDb().query.autoCaseDrafts.findFirst({
		where: and(eq(autoCaseDrafts.chatId, chatId), eq(autoCaseDrafts.caseId, caseId)),
	});
	return row ? parseDraft(row.draftJson) : null;
}

/** Save the chat's Case draft and show it. */
async function saveDraft(chatId: string, draft: CaseDraft): Promise<void> {
	const row = {
		chatId,
		caseId: draft.caseId,
		draftJson: JSON.stringify(draft),
		updatedAt: draft.updatedAt,
	};
	await getCatalogDb()
		.insert(autoCaseDrafts)
		.values(row)
		.onConflictDoUpdate({ target: autoCaseDrafts.chatId, set: row });
	publish(chatId, { type: "draft", draft });
}

/**
 * Run the whole of the chat's `draft` and wait for it to end, its Run card on the chat's
 * events. A clean passed Run (never taken over) of a draft unchanged since it started is the
 * draft's passing Run, with the Case Script it learned. Why it cannot start, as text.
 */
async function runDraft(
	chatId: string,
	catalogCase: CatalogCase,
	draft: CaseDraft,
	signal: AbortSignal,
): Promise<ChatDraftRun | string> {
	const result = await runChatDraft({
		chatId,
		catalogCase,
		draft,
		signal,
		report: (run) => publish(chatId, { type: "run", run }),
	});
	if (typeof result === "string") return result;
	const passed =
		result.run.status === "passed" && !result.takenOver
			? recordPass(chatId, catalogCase.id, draft.updatedAt, result)
			: null;
	if (passed) publish(chatId, { type: "draft", draft: passed });
	return { ...result, passing: passed !== null };
}

/**
 * Make `result` the passing Run of the chat's draft, if the draft is still the one that ran
 * (`ranAt`, its `updatedAt` then). Read and written in one transaction, so a ✕ or Reject all
 * meanwhile is never undone. The draft with its pass, or null when it changed or is gone.
 */
function recordPass(
	chatId: string,
	caseId: string,
	ranAt: number,
	result: { run: { id: string }; passingScript: CaseDraft["learnedScript"] },
): CaseDraft | null {
	return getCatalogDb().transaction((tx) => {
		const current = draftIn(tx, chatId, caseId);
		if (!current || current.updatedAt !== ranAt) return null;
		const passed = { ...current, passingRunId: result.run.id, learnedScript: result.passingScript };
		tx.update(autoCaseDrafts)
			.set({ draftJson: JSON.stringify(passed) })
			.where(eq(autoCaseDrafts.chatId, chatId))
			.run();
		return passed;
	});
}

/** The chat's Case draft of `caseId`, read inside `tx`. */
function draftIn(tx: CatalogTx, chatId: string, caseId: string): CaseDraft | null {
	const row = tx
		.select()
		.from(autoCaseDrafts)
		.where(and(eq(autoCaseDrafts.chatId, chatId), eq(autoCaseDrafts.caseId, caseId)))
		.get();
	return row ? parseDraft(row.draftJson) : null;
}

/** The chat's Case draft, which the Test tab's actions need. */
async function chatDraft(chatId: string): Promise<CaseDraft> {
	const { caseId } = await chatRow(chatId);
	const draft = await readDraft(chatId, caseId);
	if (!draft) throw new AutoNotFoundError("This chat has no Case draft.");
	return draft;
}

/** ✕ in the Test tab: remove one step from the chat's Case draft, which must then pass again. */
export async function removeDraftStep(chatId: string, stepId: string): Promise<AutoChat> {
	const draft = await chatDraft(chatId);
	const index = draft.steps.findIndex((step) => step.id === stepId);
	if (index < 0) throw new AutoNotFoundError("That step is not in the Case draft.");
	const written = removeStep(draft, index + 1, REMOVED_IN_TEST_TAB);
	if (typeof written === "string") throw new AutoValidationError(written);
	await saveDraft(chatId, written);
	return getChat(chatId);
}

/** Show the chat's Test Case's previous version, just changed by Apply or Restore. */
async function publishPreviousVersion(chatId: string, caseId: string): Promise<void> {
	publish(chatId, {
		type: "previous_version",
		previousVersion: await getCasePreviousVersion(caseId),
	});
}

/** Reject all: throw the chat's Case draft away. The Test Case is left as it is. */
export async function rejectDraft(chatId: string): Promise<AutoChat> {
	await chatDraft(chatId);
	await getCatalogDb().delete(autoCaseDrafts).where(eq(autoCaseDrafts.chatId, chatId));
	publish(chatId, { type: "draft", draft: null });
	return getChat(chatId);
}

/** Swap the chat's Test Case's current and previous versions (steps and Case Script). */
export async function restorePreviousVersion(chatId: string): Promise<AutoChat> {
	const { caseId } = await chatRow(chatId);
	if (!caseId || !restoreCasePreviousVersion(caseId)) {
		throw new AutoConflictError("The Test Case has no previous version to restore.");
	}
	await publishPreviousVersion(chatId, caseId);
	return getChat(chatId);
}

/**
 * Apply the chat's Case draft to its Test Case: its steps and the Case Script its passing Run
 * learned, together, the replaced ones kept as the case's previous version; the draft is then
 * gone. Refused, with why, unless a Run of the whole draft passed since its last change, or
 * when the Test Case was edited since the draft started.
 */
export async function applyDraft(chatId: string): Promise<AutoChat> {
	const { caseId } = await chatRow(chatId);
	if (!caseId) throw new AutoConflictError("This chat has no Case draft to apply.");
	// Read, checked and applied in one transaction: a change to the draft meanwhile cannot slip in.
	const refusal = getCatalogDb().transaction((tx) => {
		const draft = draftIn(tx, chatId, caseId);
		if (!draft) return "This chat has no Case draft to apply.";
		if (!draft.passingRunId) {
			return "The Case draft has no passing Run yet: run the whole draft, and apply it once it passes.";
		}
		if (!draft.learnedScript) {
			return "The passing Run learned no Case Script (it took no Actions), so the applied Test Case could not replay. Change the draft so its steps act, and run it again.";
		}
		if (caseEditedSince(draft, caseStepsIn(tx, caseId) ?? [])) {
			return "The Test Case was edited since the Case draft started, so applying it would undo that edit. Reject all and ask for the fix again.";
		}
		replaceCaseVersion(tx, caseId, {
			steps: draft.steps.map(({ reason: _reason, ...step }) => step),
			script: draft.learnedScript,
		});
		tx.delete(autoCaseDrafts).where(eq(autoCaseDrafts.chatId, chatId)).run();
		return null;
	});
	if (refusal) throw new AutoConflictError(refusal);
	publish(chatId, { type: "draft", draft: null });
	await publishPreviousVersion(chatId, caseId);
	return getChat(chatId);
}

/** Pause, take over or resume the chat's Run of its draft in progress. */
export async function controlRun(chatId: string, control: AutoRunControl): Promise<AutoChat> {
	await chatRow(chatId);
	const refusal = await controlChatRun(chatId, control);
	if (refusal) throw new AutoConflictError(refusal);
	return getChat(chatId);
}

/** Stop the chat's Run of its draft in progress. */
export async function stopRun(chatId: string): Promise<void> {
	await chatRow(chatId);
	if (!(await stopChatRun(chatId))) {
		throw new AutoConflictError("No Run of this chat is in progress.");
	}
}

export async function listChats(appId: string): Promise<AutoChatSummary[]> {
	if (!(await getApp(appId))) throw new AutoNotFoundError("App not found");
	const rows = await getCatalogDb()
		.select()
		.from(autoChats)
		.where(eq(autoChats.appId, appId))
		.orderBy(desc(autoChats.createdAt), desc(autoChats.id));
	const chats: AutoChatSummary[] = [];
	for (const row of rows) chats.push(await summaryFromRow(row));
	return chats;
}

/** A case the chat may work on: one of its App's. */
async function caseOfApp(appId: string, caseId: string): Promise<string> {
	const catalogCase = await getCase(caseId);
	if (!catalogCase || catalogCase.appId !== appId) {
		throw new AutoValidationError("That Test Case is not one of this App's");
	}
	return catalogCase.id;
}

/** A new chat on an App; "Chat about this case" starts it on `caseId`. */
export async function createChat(appId: string, input: CreateAutoChatRequest): Promise<AutoChat> {
	if (!(await getApp(appId))) throw new AutoNotFoundError("App not found");
	const caseId = input.caseId ? await caseOfApp(appId, input.caseId) : null;
	const now = Date.now();
	const id = newId("chat");
	await getCatalogDb().insert(autoChats).values({
		id,
		appId,
		caseId,
		title: NEW_CHAT_TITLE,
		model: null,
		sdkSessionId: null,
		createdAt: now,
		updatedAt: now,
	});
	return getChat(id);
}

async function touchChat(chatId: string, patch: Partial<ChatRow>): Promise<AutoChatSummary> {
	await getCatalogDb()
		.update(autoChats)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(autoChats.id, chatId));
	const summary = await chatSummary(chatId);
	publish(chatId, { type: "chat", chat: summary });
	return summary;
}

/**
 * Set the chat's Test Case, only while it has none: of two attempts at once, one wins.
 * Null when it already had one.
 */
async function setChatCase(chatId: string, caseId: string): Promise<AutoChatSummary | null> {
	const updated = await getCatalogDb()
		.update(autoChats)
		.set({ caseId, updatedAt: Date.now() })
		.where(and(eq(autoChats.id, chatId), isNull(autoChats.caseId)))
		.returning({ id: autoChats.id });
	if (updated.length === 0) return null;
	const summary = await chatSummary(chatId);
	publish(chatId, { type: "chat", chat: summary });
	return summary;
}

export async function updateChat(chatId: string, input: UpdateAutoChatRequest): Promise<AutoChat> {
	await chatRow(chatId);
	if (input.model !== undefined) await touchChat(chatId, { model: input.model });
	return getChat(chatId);
}

/** Delete a chat, its messages and its working folder; a reply being written is stopped. */
export async function deleteChat(chatId: string): Promise<void> {
	await chatRow(chatId);
	activeTurns.get(chatId)?.abort.abort();
	queues.delete(chatId);
	await getCatalogDb().delete(autoChats).where(eq(autoChats.id, chatId));
	await rm(autoChatDir(chatId), { recursive: true, force: true });
	for (const listener of listeners.get(chatId) ?? []) listener.closed();
	listeners.delete(chatId);
}

/** A chat's title from its first message: its first line, cut short. */
function titleFrom(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

async function saveMessage(
	chatId: string,
	input: Pick<AutoMessage, "role" | "mode" | "text" | "toolCalls" | "error">,
): Promise<AutoMessage> {
	const db = getCatalogDb();
	const [last] = await db
		.select({ seq: max(autoMessages.seq) })
		.from(autoMessages)
		.where(eq(autoMessages.chatId, chatId));
	const row: MessageRow = {
		id: newId("msg"),
		chatId,
		seq: (last?.seq ?? -1) + 1,
		role: input.role,
		mode: input.mode,
		text: input.text,
		toolCallsJson: JSON.stringify(input.toolCalls),
		error: input.error,
		createdAt: Date.now(),
	};
	await db.insert(autoMessages).values(row);
	const message = messageFromRow(row);
	publish(chatId, { type: "message", message });
	return message;
}

/** What the chat agent is told about the chat it is in. */
async function systemPrompt(chat: ChatRow): Promise<string> {
	const app = await getApp(chat.appId);
	const summary = await summaryFromRow(chat);
	const testCase = summary.caseNumber
		? `This chat works on Test Case #${summary.caseNumber} ${summary.caseName}.`
		: "This chat has no Test Case yet. When the user names one (for example #8), set it with set_test_case, once.";
	return [
		`You are the chat agent in Yoqa's Auto screen, helping test the App "${app?.name ?? chat.appId}".`,
		"You work only through the Yoqa tools: you have no files, no shell and no web.",
		testCase,
		"Each message starts with its mode. In Ask mode you only read the Test Case, its Runs and its Case draft: you cannot change anything or touch the device. When asked to, say that Run mode will do it.",
		"In Run mode you may also write the Case draft: the steps you propose for the chat's Test Case, each with instructions and an expected result, and each change with a short reason. You never edit the saved Test Case: the user applies the draft.",
		"In Run mode you may also run the whole draft on the connected device with run_case_draft. The Yoqa agent drives the device; you get each step back as text. The user can apply the draft only after a Run of it passes, and any change to the draft means it must pass again.",
		"Messages the user sends during a Run wait until it ends, then come to you together in one turn, in the narrowest of their modes.",
		"Be brief. Name the step numbers and Run ids you read; never state a result you have not read.",
	].join("\n");
}

/**
 * Send a message to a chat: saved and shown at once, answered by `agent` in the background,
 * the reply streaming on the chat's events. While the chat's Run is in progress, or messages
 * already wait for it, it is queued instead. Ask and Run work for now; one reply at a time.
 */
export async function sendMessage(
	agent: ChatAgent,
	chatId: string,
	input: SendAutoMessageRequest,
): Promise<SendAutoMessageResponse> {
	const chat = await chatRow(chatId);
	if (input.mode === "explore") {
		throw new AutoValidationError(
			`${MODE_LABEL[input.mode]} mode is not here yet: Auto answers in Ask and Run modes for now.`,
		);
	}
	const status = await agent.status();
	if (!status.signedIn) {
		throw new AutoConflictError(`Auto needs the Claude Provider signed in. ${status.detail}`);
	}
	if (chatRunInProgress(chatId) || queues.has(chatId)) {
		const queued = {
			id: newId("queued"),
			mode: input.mode,
			text: input.text,
			createdAt: Date.now(),
		};
		setQueue(chatId, [...(queues.get(chatId) ?? []), queued]);
		// Nothing left to wait for (the Run and its reply ended meanwhile): it goes now.
		sendQueue(agent, chatId);
		return { type: "queued", queued };
	}
	if (activeTurns.has(chatId)) {
		throw new AutoConflictError("A reply is still being written. Send again once it ends.");
	}
	const turn = startTurn(chatId);
	try {
		const message = await saveUserMessage(chatId, input);
		await touchChat(chatId, chat.title === NEW_CHAT_TITLE ? { title: titleFrom(input.text) } : {});
		void answerTurn(agent, chatId, [message], turn);
		return { type: "sent", message };
	} catch (error) {
		activeTurns.delete(chatId);
		throw error;
	}
}

/** A reply starts being written: until it ends, no other turn of the chat may start. */
function startTurn(chatId: string): ActiveTurn {
	const turn: ActiveTurn = { reply: { text: "", toolCalls: [] }, abort: new AbortController() };
	activeTurns.set(chatId, turn);
	return turn;
}

function saveUserMessage(chatId: string, input: SendAutoMessageRequest): Promise<AutoMessage> {
	return saveMessage(chatId, {
		role: "user",
		mode: input.mode,
		text: input.text,
		toolCalls: [],
		error: null,
	});
}

/** Set the chat's queue and show it. */
function setQueue(chatId: string, queue: AutoQueuedMessage[]): void {
	if (queue.length > 0) queues.set(chatId, queue);
	else queues.delete(chatId);
	publish(chatId, { type: "queue", queue });
}

/** Take back one queued message before it is sent. */
export async function removeQueuedMessage(chatId: string, queuedId: string): Promise<AutoChat> {
	await chatRow(chatId);
	const queue = queues.get(chatId) ?? [];
	if (!queue.some((queued) => queued.id === queuedId)) {
		throw new AutoNotFoundError("That message is not queued: it was sent or removed.");
	}
	setQueue(
		chatId,
		queue.filter((queued) => queued.id !== queuedId),
	);
	return getChat(chatId);
}

/**
 * Once the chat's Run and the reply it is part of have both ended, send every queued message
 * to `agent` together, saved in order, as one turn. Stopping the Run only ends it sooner.
 */
function sendQueue(agent: ChatAgent, chatId: string): void {
	const queue = queues.get(chatId);
	if (!queue || activeTurns.has(chatId) || chatRunInProgress(chatId)) return;
	setQueue(chatId, []);
	const turn = startTurn(chatId);
	void (async () => {
		const messages: AutoMessage[] = [];
		try {
			for (const queued of queue) messages.push(await saveUserMessage(chatId, queued));
			await touchChat(chatId, {});
		} catch (error) {
			console.error(`[auto] sending the queue of ${chatId} failed`, error);
			// Those not saved go back to the front of the queue, unless the chat was deleted.
			if (!turn.abort.signal.aborted) {
				setQueue(chatId, [...queue.slice(messages.length), ...(queues.get(chatId) ?? [])]);
			}
			if (messages.length === 0) {
				activeTurns.delete(chatId);
				return;
			}
		}
		await answerTurn(agent, chatId, messages, turn);
	})();
}

/**
 * The mode of a turn of several messages: the narrowest of theirs, so none gets more tools
 * than its own mode allows.
 */
function turnMode(messages: AutoMessage[]): AutoChatMode {
	const modes = messages.map((message) => message.mode ?? "ask");
	return MODES_NARROWEST_FIRST.find((mode) => modes.includes(mode)) ?? "ask";
}

/**
 * What the agent is sent: the message after its mode, or the queued messages together,
 * numbered in order, each naming its own mode where it differs from the turn's.
 */
function turnPrompt(messages: AutoMessage[], mode: AutoChatMode): string {
	const label = `[${MODE_LABEL[mode]} mode]`;
	const [only] = messages;
	if (messages.length === 1 && only) return `${label} ${only.text}`;
	const lines = messages.map((message, index) => {
		const own =
			message.mode && message.mode !== mode ? ` (sent in ${MODE_LABEL[message.mode]} mode)` : "";
		return `${index + 1}.${own} ${message.text}`;
	});
	return [`${label} The user sent these messages during the Run, in order:`, ...lines].join("\n");
}

/**
 * Run the chat agent on one turn of `messages` (one, or the queue), publish what it writes
 * and calls, and save its reply; then send what was queued meanwhile.
 */
async function answerTurn(
	agent: ChatAgent,
	chatId: string,
	messages: AutoMessage[],
	turn: ActiveTurn,
): Promise<void> {
	const mode = turnMode(messages);
	let error: string | null = null;
	try {
		const chat = await chatRow(chatId);
		const tools = chatTools({
			appId: chat.appId,
			caseId: async () => (await chatRow(chatId)).caseId,
			setCase: (caseId) => setChatCase(chatId, caseId),
			draft: async (caseId) => readDraft(chatId, caseId),
			saveDraft: (draft) => saveDraft(chatId, draft),
			// A Run that outlives its turn (the agent failed while it ran) sends the queue as it ends.
			runDraft: (catalogCase, draft) =>
				runDraft(chatId, catalogCase, draft, turn.abort.signal).finally(() =>
					sendQueue(agent, chatId),
				),
		});
		const callTool = async (name: string, input: unknown): Promise<ChatToolOutput> => {
			const call: AutoToolCall = { id: newId("call"), name, input, output: null, isError: false };
			turn.reply.toolCalls.push(call);
			publish(chatId, { type: "tool_call", call: { id: call.id, name, input } });
			const output = await callChatTool(tools, mode, name, input);
			call.output = output.text;
			call.isError = output.isError;
			publish(chatId, {
				type: "tool_result",
				id: call.id,
				output: output.text,
				isError: output.isError,
			});
			return output;
		};
		const events = agent.runTurn({
			chatId,
			prompt: turnPrompt(messages, mode),
			mode,
			model: chat.model,
			agentSessionId: chat.sdkSessionId,
			systemPrompt: await systemPrompt(chat),
			tools: tools.filter((tool) => tool.modes.includes(mode)),
			callTool,
			signal: turn.abort.signal,
		});
		for await (const event of events) {
			if (event.type === "agent_session") {
				await getCatalogDb()
					.update(autoChats)
					.set({ sdkSessionId: event.agentSessionId })
					.where(eq(autoChats.id, chatId));
			} else {
				turn.reply.text += event.delta;
				publish(chatId, { type: "text", delta: event.delta });
			}
		}
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	}
	try {
		// A chat deleted while its reply was written keeps nothing.
		if (turn.abort.signal.aborted) return;
		await saveMessage(chatId, {
			role: "assistant",
			mode: null,
			text: turn.reply.text,
			toolCalls: turn.reply.toolCalls,
			error,
		});
	} catch (saveError) {
		console.error(`[auto] saving the reply in ${chatId} failed`, saveError);
	} finally {
		// Only now may the next message start: its prompt comes after this reply.
		activeTurns.delete(chatId);
		sendQueue(agent, chatId);
	}
}
