import { z } from "zod";
import {
	caseFlowStepSchema,
	caseScriptSchema,
	providerKindSchema,
	runStatusSchema,
	runTestStatusSchema,
} from "./schemas";

/**
 * Auto chat: a saved conversation, on one App, with the chat agent about at most one Test
 * Case. What the agent may do is set by the mode of each message (CONTEXT.md → Auto).
 */

/**
 * Ask reads only; Run may also write the Case draft and start Runs; Explore may also read the
 * Screen, drive the device and propose a new Test Case.
 */
export const autoChatModeSchema = z.union([
	z.literal("ask"),
	z.literal("run"),
	z.literal("explore"),
]);
export type AutoChatMode = z.infer<typeof autoChatModeSchema>;

/** One call the chat agent made to a Yoqa tool, with what the tool answered (null while it runs). */
export const autoToolCallSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	input: z.unknown(),
	output: z.string().nullable(),
	isError: z.boolean(),
});
export type AutoToolCall = z.infer<typeof autoToolCallSchema>;

/** A saved message: the user's prompt, with its mode, or the agent's reply with its tool calls. */
export const autoMessageSchema = z.object({
	id: z.string().min(1),
	chatId: z.string().min(1),
	role: z.union([z.literal("user"), z.literal("assistant")]),
	/** The mode a user message was sent in; null on a reply. */
	mode: autoChatModeSchema.nullable(),
	text: z.string(),
	toolCalls: z.array(autoToolCallSchema),
	/** Why a reply stopped short; null otherwise. */
	error: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
});
export type AutoMessage = z.infer<typeof autoMessageSchema>;

/**
 * A message sent while the chat's Run is live: held in order, and removable, until the Run
 * ends; then every one still queued goes to the agent together, as one turn.
 */
export const autoQueuedMessageSchema = z.object({
	id: z.string().min(1),
	mode: autoChatModeSchema,
	text: z.string(),
	createdAt: z.number().int().nonnegative(),
});
export type AutoQueuedMessage = z.infer<typeof autoQueuedMessageSchema>;

/** A chat as the chat picker lists it, with the Test Case its header names. */
export const autoChatSummarySchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	caseId: z.string().min(1).nullable(),
	caseNumber: z.number().int().positive().nullable(),
	caseName: z.string().nullable(),
	title: z.string(),
	/**
	 * The Provider that answers this chat; null when it has none (a chat from before Auto ran
	 * on any Provider, with no Claude Provider). A null or unusable one fails the next message.
	 */
	providerId: z.string().min(1).nullable(),
	/** The chat model this chat uses; null for its Provider's default. */
	model: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});
export type AutoChatSummary = z.infer<typeof autoChatSummarySchema>;

/**
 * A step of a Case draft: a saved step kept, changed or moved (it keeps the saved step's id),
 * or one the agent added (a new id).
 */
export const caseDraftStepSchema = caseFlowStepSchema.extend({
	/** Why the agent changed or added it; null while it is as saved. */
	reason: z.string().nullable(),
});
export type CaseDraftStep = z.infer<typeof caseDraftStepSchema>;

/** A saved step the Case draft leaves out. */
export const caseDraftRemovedStepSchema = z.object({
	before: caseFlowStepSchema,
	reason: z.string(),
});
export type CaseDraftRemovedStep = z.infer<typeof caseDraftRemovedStepSchema>;

/**
 * The steps the chat agent proposes for the chat's Test Case, saved with the chat. The
 * catalog is never written: only applying the draft does that (CONTEXT.md → Case draft).
 */
export const caseDraftSchema = z.object({
	caseId: z.string().min(1),
	/** The Test Case's steps when the draft started: what its changes are shown against. */
	base: z.array(caseFlowStepSchema),
	/** The whole draft, in order. */
	steps: z.array(caseDraftStepSchema),
	removed: z.array(caseDraftRemovedStepSchema),
	/**
	 * The Run of the whole draft that passed from a clean start, which Apply needs; null
	 * until one has, and again after any change to the draft.
	 */
	passingRunId: z.string().min(1).nullable().default(null),
	/** The Case Script that passing Run learned (or replayed), saved with the steps on Apply. */
	learnedScript: caseScriptSchema.nullable().default(null),
	updatedAt: z.number().int().nonnegative(),
});
export type CaseDraft = z.infer<typeof caseDraftSchema>;

/**
 * A new Test Case the chat agent proposes in Explore, while the chat has none: its name and
 * steps. Accepting it creates the Test Case, with no steps yet, as the chat's case, and the
 * proposed steps become its Case draft, which must pass a Run before Apply like any draft.
 */
export const caseProposalSchema = z.object({
	name: z.string().trim().min(1),
	/** What the case checks, and why the agent proposes it. */
	reason: z.string(),
	steps: z.array(caseFlowStepSchema.pick({ instructions: true, expectedResult: true })).min(1),
	updatedAt: z.number().int().nonnegative(),
});
export type CaseProposal = z.infer<typeof caseProposalSchema>;

/**
 * A Test Case's one previous version: the steps and Case Script that applying a Case draft
 * replaced. Restore previous version swaps it with the current ones.
 */
export const casePreviousVersionSchema = z.object({
	steps: z.array(caseFlowStepSchema),
	hasScript: z.boolean(),
	/** When it was replaced (by Apply, or by a Restore). */
	replacedAt: z.number().int().nonnegative(),
});
export type CasePreviousVersion = z.infer<typeof casePreviousVersionSchema>;

/** One step of the Case draft as a Run of it goes: its text, how far it got, and what it did. */
export const autoRunStepSchema = z.object({
	instructions: z.string(),
	expectedResult: z.string(),
	status: z.union([
		z.literal("pending"),
		z.literal("running"),
		z.literal("passed"),
		z.literal("failed"),
		z.literal("stopped"),
	]),
	/** The command line of each Action it took, in order (for example `tap --x 196 --y 488`). */
	commands: z.array(z.string()),
});
export type AutoRunStep = z.infer<typeof autoRunStepSchema>;

/** Where a chat's Run is with Pause and Take over. */
export const autoRunPauseSchema = z.union([
	z.literal("pausing"),
	z.literal("paused"),
	z.literal("taken_over"),
]);
export type AutoRunPause = z.infer<typeof autoRunPauseSchema>;

/** Run control from the Run card, besides Stop: each is its route, `/auto/chats/:id/run/<control>`. */
export type AutoRunControl = "pause" | "take-over" | "resume";

/**
 * A Run of the chat's Case draft, as the chat's Run card shows it, taken from the Run's own
 * steps. It is a normal Run: its detail page has the rest.
 */
export const autoRunSchema = z.object({
	runId: z.string().min(1),
	caseId: z.string().min(1),
	status: runStatusSchema,
	/** How the case ran: the agent, or a replay of the draft's Case Script; null before it starts. */
	executionMode: z.union([z.literal("agent"), z.literal("script")]).nullable(),
	/** The vision Provider driving the Run (the app default); null when it replays a Case Script. */
	provider: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
	startedAt: z.number().int().nonnegative().nullable(),
	finishedAt: z.number().int().nonnegative().nullable(),
	/** The draft step (from 1) the Run is on; null before it starts and once it ends. */
	currentStep: z.number().int().positive().nullable(),
	/** The command in flight right now; null between Actions. */
	currentCommand: z.string().nullable(),
	/**
	 * Pause and Take over: `pausing` until the Action in flight settles, then `paused`, or
	 * `taken_over` while the user drives the device by hand; null while the Run goes on.
	 */
	pause: autoRunPauseSchema.nullable(),
	steps: z.array(autoRunStepSchema),
	/** The commands a replayed Case Script ran: a replay does not say which step each is of. */
	replayed: z.array(z.string()),
	error: z.string().nullable(),
});
export type AutoRun = z.infer<typeof autoRunSchema>;

/** The reply being written right now, so a screen that opens mid-turn can show it. */
export const autoReplySchema = z.object({
	text: z.string(),
	toolCalls: z.array(autoToolCallSchema),
});
export type AutoReply = z.infer<typeof autoReplySchema>;

export const autoChatSchema = autoChatSummarySchema.extend({
	messages: z.array(autoMessageSchema),
	/** Null when no reply is being written. */
	reply: autoReplySchema.nullable(),
	/** The chat's Case draft; null until the agent writes one. */
	draft: caseDraftSchema.nullable(),
	/** The new Test Case proposed in Explore, waiting to be accepted; null when none is. */
	proposal: caseProposalSchema.nullable(),
	/** The Run of the draft in progress; null when none is. */
	run: autoRunSchema.nullable(),
	/** The chat's Test Case's previous version, which Restore puts back; null when it has none. */
	previousVersion: casePreviousVersionSchema.nullable(),
	/** The messages queued until the chat's Run ends, in order. */
	queue: z.array(autoQueuedMessageSchema),
});
export type AutoChat = z.infer<typeof autoChatSchema>;

export const listAutoChatsResponseSchema = z.object({
	chats: z.array(autoChatSummarySchema),
});
export type ListAutoChatsResponse = z.infer<typeof listAutoChatsResponseSchema>;

export const createAutoChatRequestSchema = z.object({
	/** "Chat about this case": the chat starts on this Test Case. */
	caseId: z.string().min(1).optional(),
});
export type CreateAutoChatRequest = z.infer<typeof createAutoChatRequestSchema>;

/**
 * Pick the chat's Provider and model, together or the model alone. A Provider that cannot
 * chat now (not Chat-capable in its auth mode, disabled, signed out) is refused, 400.
 * Another Provider starts it afresh from the chat's visible conversation; another model of
 * the same Provider keeps the agent's own history.
 */
export const updateAutoChatRequestSchema = z.object({
	providerId: z.string().min(1).optional(),
	/** The chat model for this chat; null for its Provider's default. */
	model: z.string().min(1).nullable().optional(),
});
export type UpdateAutoChatRequest = z.infer<typeof updateAutoChatRequestSchema>;

export const sendAutoMessageRequestSchema = z.object({
	text: z.string().trim().min(1),
	mode: autoChatModeSchema,
});
export type SendAutoMessageRequest = z.infer<typeof sendAutoMessageRequestSchema>;

/** What sending a message did: sent to the agent, or queued because the chat's Run is live. */
export const sendAutoMessageResponseSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("sent"), message: autoMessageSchema }),
	z.object({ type: z.literal("queued"), queued: autoQueuedMessageSchema }),
]);
export type SendAutoMessageResponse = z.infer<typeof sendAutoMessageResponseSchema>;

/**
 * How one step of the Test Case went in one Run, for the History tab's per-step strip:
 * `skipped` once the Run failed or stopped before it, `pending` while a Run in progress has
 * not reached it yet.
 */
export const historyStepResultSchema = z.union([
	z.literal("passed"),
	z.literal("failed"),
	z.literal("skipped"),
	z.literal("running"),
	z.literal("pending"),
]);
export type HistoryStepResult = z.infer<typeof historyStepResultSchema>;

/** One recent Run of a Test Case, as the History tab charts and lists it. */
export const historyRunSchema = z.object({
	runId: z.string().min(1),
	/** The Run's number among the case's Runs, oldest first. */
	number: z.number().int().positive(),
	/** How the case went in the Run (`errored` is a failure). */
	status: runTestStatusSchema,
	/** The Auto chat that started the Run, while that chat exists. */
	autoChat: z.object({ id: z.string().min(1), title: z.string() }).nullable(),
	createdAt: z.number().int().nonnegative(),
	/** How long the case ran; null until it ends. */
	durationMs: z.number().int().nonnegative().nullable(),
	/** The step (from 1) a Run in progress is on; null otherwise, and on a replay. */
	currentStep: z.number().int().positive().nullable(),
	/**
	 * The step (from 1) a failed Run stopped at; null otherwise, and when no step says (a
	 * replayed Case Script does not say which step it is on).
	 */
	failedStep: z.number().int().positive().nullable(),
	/** Each of the steps the Run ran (the Case draft's, for a Run of one), in order. */
	steps: z.array(historyStepResultSchema),
});
export type HistoryRun = z.infer<typeof historyRunSchema>;

/**
 * The History note, from a fixed rule over the Runs that ended (stopped ones are left out):
 * - `consistent`: the last `failures` (two or more) failed at the same `step`, the first of
 *   them at `since`.
 * - `flaky`: the last five mix passes and failures, and they all ran the same steps.
 */
export const historyNoteSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("consistent"),
		step: z.number().int().positive(),
		failures: z.number().int().min(2),
		since: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("flaky"),
		passed: z.number().int().positive(),
		failed: z.number().int().positive(),
	}),
]);
export type HistoryNote = z.infer<typeof historyNoteSchema>;

/**
 * A Test Case's History summary, over its recent Runs: how many passed and failed (a Run
 * stopped or in progress is neither), the average time of the passing ones, each Run, and
 * the note.
 */
export const caseHistorySchema = z.object({
	caseId: z.string().min(1),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	/** Null while no recent Run passed. */
	averagePassMs: z.number().int().nonnegative().nullable(),
	/** The recent Runs, newest first. */
	runs: z.array(historyRunSchema),
	note: historyNoteSchema.nullable(),
});
export type CaseHistory = z.infer<typeof caseHistorySchema>;

/** Whether Auto can talk to a chat agent: any Chat-capable Provider is signed in. */
export const autoStatusSchema = z.object({
	signedIn: z.boolean(),
	detail: z.string(),
});
export type AutoStatus = z.infer<typeof autoStatusSchema>;

export const autoModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
});
export type AutoModel = z.infer<typeof autoModelSchema>;

/**
 * A Provider as the composer's picker shows it: its models, or, when it cannot chat now, why
 * (not Chat-capable in its auth mode, such as a CLI login only the Claude Provider can chat
 * on yet, or signed out).
 */
export const autoChatProviderSchema = z.object({
	id: z.string().min(1),
	kind: providerKindSchema,
	label: z.string().min(1),
	/** Whether it can answer a chat now. */
	available: z.boolean(),
	/** Why it cannot; null when it can. */
	reason: z.string().nullable(),
	models: z.array(autoModelSchema),
	/** What a chat on it with no model of its own uses; null for its own default (Claude CLI). */
	defaultModel: z.string().min(1).nullable(),
});
export type AutoChatProvider = z.infer<typeof autoChatProviderSchema>;

/** Every enabled Provider for the picker, grouped, and the Provider a new chat starts on. */
export const listAutoModelsResponseSchema = z.object({
	providers: z.array(autoChatProviderSchema),
	/** The app's default Provider when it can chat, else the first that can; null when none can. */
	defaultProviderId: z.string().min(1).nullable(),
});
export type ListAutoModelsResponse = z.infer<typeof listAutoModelsResponseSchema>;

/**
 * One event on a chat's SSE stream (`GET /auto/chats/:id/events`, each as `data:` JSON).
 * - `message`: a message was saved — the user's prompt as it is sent, the reply once it ends.
 * - `text`: more of the reply's text.
 * - `tool_call` / `tool_result`: the agent called a Yoqa tool, and what it answered.
 * - `chat`: the chat itself changed (its Test Case, title, Provider or model).
 * - `draft`: the chat's Case draft changed (null once it is gone).
 * - `run`: a Run of the draft started or moved on; sent once more when it ends.
 * - `previous_version`: Apply or Restore changed the Test Case's previous version.
 * - `queue`: a message was queued or removed, or the queue went to the agent (now empty).
 */
export const autoChatEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("message"), message: autoMessageSchema }),
	z.object({ type: z.literal("text"), delta: z.string() }),
	z.object({
		type: z.literal("tool_call"),
		call: autoToolCallSchema.pick({ id: true, name: true, input: true }),
	}),
	z.object({
		type: z.literal("tool_result"),
		id: z.string().min(1),
		output: z.string(),
		isError: z.boolean(),
	}),
	z.object({ type: z.literal("chat"), chat: autoChatSummarySchema }),
	z.object({ type: z.literal("draft"), draft: caseDraftSchema.nullable() }),
	z.object({ type: z.literal("proposal"), proposal: caseProposalSchema.nullable() }),
	z.object({ type: z.literal("run"), run: autoRunSchema }),
	z.object({
		type: z.literal("previous_version"),
		previousVersion: casePreviousVersionSchema.nullable(),
	}),
	z.object({ type: z.literal("queue"), queue: z.array(autoQueuedMessageSchema) }),
]);
export type AutoChatEvent = z.infer<typeof autoChatEventSchema>;
