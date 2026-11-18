import {
	type AutoChatEvent,
	createAutoChatRequestSchema,
	sendAutoMessageRequestSchema,
	updateAutoChatRequestSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
	AutoConflictError,
	AutoNotFoundError,
	AutoValidationError,
	acceptProposal,
	applyDraft,
	controlRun,
	createChat,
	deleteChat,
	getChat,
	listChats,
	rejectDraft,
	rejectProposal,
	removeDraftStep,
	removeQueuedMessage,
	restorePreviousVersion,
	sendMessage,
	stopRun,
	subscribeToChat,
	updateChat,
} from "../../domains/auto/application";
import type { ChatAgent } from "../../domains/auto/chat-agent";
import { createClaudeChatAgent } from "../../domains/auto/claude-agent";

function autoErrorResponse(error: unknown): { status: 400 | 404 | 409 | 500; message: string } {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof AutoNotFoundError) return { status: 404, message };
	if (error instanceof AutoValidationError) return { status: 400, message };
	if (error instanceof AutoConflictError) return { status: 409, message };
	return { status: 500, message };
}

async function readJson(request: Request): Promise<{ ok: true; json: unknown } | { ok: false }> {
	try {
		return { ok: true, json: await request.json() };
	} catch {
		return { ok: false };
	}
}

/** A JSON body parsed with `schema`, or the 400 to answer with. */
async function parseBody<T>(
	request: Request,
	schema: {
		safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: Error };
	},
): Promise<{ ok: true; data: T } | { ok: false; error: { error: string; detail?: string } }> {
	const body = await readJson(request);
	if (!body.ok) return { ok: false, error: { error: "Invalid JSON body" } };
	const parsed = schema.safeParse(body.json);
	if (!parsed.success) {
		return { ok: false, error: { error: "Invalid request", detail: parsed.error.message } };
	}
	return { ok: true, data: parsed.data };
}

/** The Auto chat routes. `agent` answers the chats: the Claude Agent SDK unless a test gives one. */
export function createAutoRoutes(options: { agent?: ChatAgent } = {}) {
	const agent = options.agent ?? createClaudeChatAgent();
	const app = new Hono();

	app.onError((error, c) => {
		const { status, message } = autoErrorResponse(error);
		if (status === 500) console.error("[auto]", error);
		return c.json({ error: message }, status);
	});

	app.get("/auto/status", async (c) => c.json(await agent.status()));

	app.get("/auto/models", async (c) => c.json(await agent.models()));

	app.get("/apps/:appId/auto/chats", async (c) =>
		c.json({ chats: await listChats(c.req.param("appId")) }),
	);

	app.post("/apps/:appId/auto/chats", async (c) => {
		const parsed = await parseBody(c.req.raw, createAutoChatRequestSchema);
		if (!parsed.ok) return c.json(parsed.error, 400);
		return c.json(await createChat(c.req.param("appId"), parsed.data), 201);
	});

	app.get("/auto/chats/:chatId", async (c) => c.json(await getChat(c.req.param("chatId"))));

	app.patch("/auto/chats/:chatId", async (c) => {
		const parsed = await parseBody(c.req.raw, updateAutoChatRequestSchema);
		if (!parsed.ok) return c.json(parsed.error, 400);
		return c.json(await updateChat(c.req.param("chatId"), parsed.data));
	});

	app.delete("/auto/chats/:chatId", async (c) => {
		await deleteChat(c.req.param("chatId"));
		return c.body(null, 204);
	});

	app.post("/auto/chats/:chatId/messages", async (c) => {
		const parsed = await parseBody(c.req.raw, sendAutoMessageRequestSchema);
		if (!parsed.ok) return c.json(parsed.error, 400);
		return c.json(await sendMessage(agent, c.req.param("chatId"), parsed.data), 202);
	});

	app.delete("/auto/chats/:chatId/queue/:queuedId", async (c) =>
		c.json(await removeQueuedMessage(c.req.param("chatId"), c.req.param("queuedId"))),
	);

	app.delete("/auto/chats/:chatId/draft", async (c) =>
		c.json(await rejectDraft(c.req.param("chatId"))),
	);

	app.delete("/auto/chats/:chatId/draft/steps/:stepId", async (c) =>
		c.json(await removeDraftStep(c.req.param("chatId"), c.req.param("stepId"))),
	);

	app.post("/auto/chats/:chatId/draft/apply", async (c) =>
		c.json(await applyDraft(c.req.param("chatId"))),
	);

	app.post("/auto/chats/:chatId/proposal/accept", async (c) =>
		c.json(await acceptProposal(c.req.param("chatId"))),
	);

	app.delete("/auto/chats/:chatId/proposal", async (c) =>
		c.json(await rejectProposal(c.req.param("chatId"))),
	);

	app.post("/auto/chats/:chatId/previous-version/restore", async (c) =>
		c.json(await restorePreviousVersion(c.req.param("chatId"))),
	);

	app.post("/auto/chats/:chatId/run/pause", async (c) =>
		c.json(await controlRun(c.req.param("chatId"), "pause")),
	);

	app.post("/auto/chats/:chatId/run/take-over", async (c) =>
		c.json(await controlRun(c.req.param("chatId"), "take-over")),
	);

	app.post("/auto/chats/:chatId/run/resume", async (c) =>
		c.json(await controlRun(c.req.param("chatId"), "resume")),
	);

	app.post("/auto/chats/:chatId/run/stop", async (c) => {
		await stopRun(c.req.param("chatId"));
		return c.body(null, 204);
	});

	app.get("/auto/chats/:chatId/events", async (c) => {
		const chatId = c.req.param("chatId");
		await getChat(chatId);
		// Subscribed before the stream opens, so nothing published from now on is missed.
		const queue: AutoChatEvent[] = [];
		let wake: (() => void) | null = null;
		let chatDeleted = false;
		const unsubscribe = subscribeToChat(chatId, {
			event: (event) => {
				queue.push(event);
				wake?.();
			},
			closed: () => {
				chatDeleted = true;
				wake?.();
			},
		});
		return streamSSE(c, async (stream) => {
			stream.onAbort(() => wake?.());
			try {
				while (!stream.aborted && !chatDeleted) {
					const event = queue.shift();
					if (event) {
						await stream.writeSSE({ data: JSON.stringify(event) });
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					wake = null;
				}
			} finally {
				unsubscribe();
			}
		});
	});

	return app;
}
