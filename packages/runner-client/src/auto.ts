import { z } from "zod";
import { caseFlowStepSchema, caseScriptSchema, runStatusSchema } from "./schemas";

/**
 * Auto chat: a saved conversation, on one App, with the chat agent about at most one Test
 * Case. What the agent may do is set by the mode of each message (CONTEXT.md → Auto).
 */

/** Ask reads only; Run may also write the Case draft and start Runs; Explore may also drive the device. */
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

/** A chat as the chat picker lists it, with the Test Case its header names. */
export const autoChatSummarySchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	caseId: z.string().min(1).nullable(),
	caseNumber: z.number().int().positive().nullable(),
	caseName: z.string().nullable(),
	title: z.string(),
	/** The chat model this chat uses; null for the Claude Provider's default. */
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
	/** The Run of the draft in progress; null when none is. */
	run: autoRunSchema.nullable(),
	/** The chat's Test Case's previous version, which Restore puts back; null when it has none. */
	previousVersion: casePreviousVersionSchema.nullable(),
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

export const updateAutoChatRequestSchema = z.object({
	/** The chat model for this chat; null for the Claude Provider's default. */
	model: z.string().min(1).nullable().optional(),
});
export type UpdateAutoChatRequest = z.infer<typeof updateAutoChatRequestSchema>;

export const sendAutoMessageRequestSchema = z.object({
	text: z.string().trim().min(1),
	mode: autoChatModeSchema,
});
export type SendAutoMessageRequest = z.infer<typeof sendAutoMessageRequestSchema>;

/** Whether Auto can talk to its chat agent: the Claude Provider is signed in. Never another Provider. */
export const autoStatusSchema = z.object({
	signedIn: z.boolean(),
	/** The Claude Provider in use; null when there is none. */
	providerId: z.string().min(1).nullable(),
	detail: z.string(),
});
export type AutoStatus = z.infer<typeof autoStatusSchema>;

export const autoModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
});
export type AutoModel = z.infer<typeof autoModelSchema>;

/** The Claude Provider's models, for the composer's model picker. */
export const listAutoModelsResponseSchema = z.object({
	models: z.array(autoModelSchema),
	/** What a chat with no model of its own uses; null for the Claude CLI's own default. */
	defaultModel: z.string().min(1).nullable(),
});
export type ListAutoModelsResponse = z.infer<typeof listAutoModelsResponseSchema>;

/**
 * One event on a chat's SSE stream (`GET /auto/chats/:id/events`, each as `data:` JSON).
 * - `message`: a message was saved — the user's prompt as it is sent, the reply once it ends.
 * - `text`: more of the reply's text.
 * - `tool_call` / `tool_result`: the agent called a Yoqa tool, and what it answered.
 * - `chat`: the chat itself changed (its Test Case, title or model).
 * - `draft`: the chat's Case draft changed (null once it is gone).
 * - `run`: a Run of the draft started or moved on; sent once more when it ends.
 * - `previous_version`: Apply or Restore changed the Test Case's previous version.
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
	z.object({ type: z.literal("run"), run: autoRunSchema }),
	z.object({
		type: z.literal("previous_version"),
		previousVersion: casePreviousVersionSchema.nullable(),
	}),
]);
export type AutoChatEvent = z.infer<typeof autoChatEventSchema>;
