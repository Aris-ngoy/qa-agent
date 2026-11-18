import { z } from "zod";
import { caseFlowStepSchema } from "./schemas";

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
	updatedAt: z.number().int().nonnegative(),
});
export type CaseDraft = z.infer<typeof caseDraftSchema>;

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
]);
export type AutoChatEvent = z.infer<typeof autoChatEventSchema>;
