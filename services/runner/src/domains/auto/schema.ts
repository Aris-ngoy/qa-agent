import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { apps, cases } from "../catalog/schema";

/** An Auto chat: on one App, about at most one Test Case, resumable through its SDK session. */
export const autoChats = sqliteTable("auto_chats", {
	id: text("id").primaryKey(),
	appId: text("app_id")
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	/** The Test Case the chat works on; set once, null until then (or once the case is deleted). */
	caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
	title: text("title").notNull(),
	/** The chat model; null for the Claude Provider's default. */
	model: text("model"),
	/** The chat agent's session, resumed on the next message. Null before the first reply. */
	sdkSessionId: text("sdk_session_id"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

/** A chat's Case draft (JSON CaseDraft); gone with the chat or its Test Case. */
export const autoCaseDrafts = sqliteTable("auto_case_drafts", {
	chatId: text("chat_id")
		.primaryKey()
		.references(() => autoChats.id, { onDelete: "cascade" }),
	caseId: text("case_id")
		.notNull()
		.references(() => cases.id, { onDelete: "cascade" }),
	draftJson: text("draft_json").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

/** A chat's proposed new Test Case (JSON CaseProposal), while the chat has none; gone with the chat. */
export const autoCaseProposals = sqliteTable("auto_case_proposals", {
	chatId: text("chat_id")
		.primaryKey()
		.references(() => autoChats.id, { onDelete: "cascade" }),
	proposalJson: text("proposal_json").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const autoMessages = sqliteTable("auto_messages", {
	id: text("id").primaryKey(),
	chatId: text("chat_id")
		.notNull()
		.references(() => autoChats.id, { onDelete: "cascade" }),
	/** Order within the chat. */
	seq: integer("seq").notNull(),
	/** user | assistant */
	role: text("role").notNull(),
	/** ask | run | explore — the mode a user message was sent in; null on a reply. */
	mode: text("mode"),
	text: text("text").notNull(),
	/** JSON AutoToolCall[] — the Yoqa tools a reply called. */
	toolCallsJson: text("tool_calls_json").notNull().default("[]"),
	/** Why a reply stopped short. */
	error: text("error"),
	createdAt: integer("created_at").notNull(),
});
