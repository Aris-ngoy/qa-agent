import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	type AutoChat,
	type AutoChatEvent,
	type CaseFlowStep,
	autoChatEventSchema,
} from "@yoqa/runner-client";
import type { ChatAgent, ChatAgentEvent, ChatTurn } from "../../domains/auto/chat-agent";
import { createApp, createCase, getCase } from "../../domains/catalog/application";
import { closeCatalogDb, getCatalogDb, openCatalogDb } from "../../domains/catalog/db";
import { runSteps, runTests, runs } from "../../domains/runs/schema";
import { createAutoRoutes } from "./auto";

/** A chat agent that answers each turn by running `script`, and records the turns it was given. */
type ScriptedAgent = ChatAgent & {
	signedIn: boolean;
	turns: ChatTurn[];
	script: (turn: ChatTurn) => AsyncGenerator<ChatAgentEvent>;
};

function scriptedAgent(): ScriptedAgent {
	const agent: ScriptedAgent = {
		signedIn: true,
		turns: [],
		script: async function* () {
			yield { type: "text", delta: "Hello" };
		},
		status: async () => ({
			signedIn: agent.signedIn,
			providerId: agent.signedIn ? "prov_claude" : null,
			detail: agent.signedIn ? "Signed in" : "Sign in the Claude Provider",
		}),
		models: async () => ({
			models: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }],
			defaultModel: null,
		}),
		runTurn: (turn) => {
			agent.turns.push(turn);
			return agent.script(turn);
		},
	};
	return agent;
}

describe("the Auto chat routes", () => {
	let agent: ScriptedAgent;
	let routes: ReturnType<typeof createAutoRoutes>;

	beforeAll(async () => {
		closeCatalogDb();
		const dir = await mkdtemp(`${tmpdir()}/auto-`);
		openCatalogDb(`${dir}/catalog.db`);
		process.env.YOQA_AUTO_CHATS_DIR = `${dir}/chats`;
	});
	afterAll(() => {
		closeCatalogDb();
		Reflect.deleteProperty(process.env, "YOQA_AUTO_CHATS_DIR");
	});
	beforeEach(() => {
		agent = scriptedAgent();
		routes = createAutoRoutes({ agent });
	});

	/** The chat's SSE stream, read event by event. */
	async function openEvents(chatId: string) {
		const response = await routes.request(`/auto/chats/${chatId}/events`);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		const events: AutoChatEvent[] = [];
		let buffer = "";
		return {
			events,
			/** Read until an event matches, and return every event read so far. */
			async until(match: (event: AutoChatEvent) => boolean): Promise<AutoChatEvent[]> {
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let end = buffer.indexOf("\n\n");
					while (end >= 0) {
						const frame = buffer.slice(0, end);
						buffer = buffer.slice(end + 2);
						const data = frame
							.split("\n")
							.filter((line) => line.startsWith("data:"))
							.map((line) => line.slice(5).trim())
							.join("");
						if (data) {
							const event = autoChatEventSchema.parse(JSON.parse(data));
							events.push(event);
							if (match(event)) return events;
						}
						end = buffer.indexOf("\n\n");
					}
				}
				throw new Error(`No matching event in ${JSON.stringify(events)}`);
			},
			/** Whether the runner ends the stream within a second. */
			async ended(): Promise<boolean> {
				const drained = (async () => {
					while (!(await reader.read()).done) {}
					return true;
				})();
				const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000));
				return Promise.race([drained, timeout]);
			},
			close: () => reader.cancel(),
		};
	}

	const isReply = (event: AutoChatEvent) =>
		event.type === "message" && event.message.role === "assistant";

	async function newChat(appId: string, caseId?: string): Promise<AutoChat> {
		const created = await json<AutoChat>(`/apps/${appId}/auto/chats`, {
			method: "POST",
			body: JSON.stringify(caseId ? { caseId } : {}),
		});
		expect(created.status).toBe(201);
		return created.body;
	}

	async function send(chatId: string, text: string, mode = "ask") {
		return json<{ id: string; error?: string }>(`/auto/chats/${chatId}/messages`, {
			method: "POST",
			body: JSON.stringify({ text, mode }),
		});
	}

	async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
		const response = await routes.request(path, {
			...init,
			headers: { "Content-Type": "application/json", ...init?.headers },
		});
		return { status: response.status, body: (await response.json().catch(() => null)) as T };
	}

	test("creates chats on an App, lists them newest first, opens one and deletes it", async () => {
		const app = await createApp({ name: "Chats" });
		const first = await json<AutoChat>(`/apps/${app.id}/auto/chats`, {
			method: "POST",
			body: "{}",
		});
		const second = await json<AutoChat>(`/apps/${app.id}/auto/chats`, {
			method: "POST",
			body: "{}",
		});
		expect(first.status).toBe(201);
		expect(first.body).toMatchObject({ appId: app.id, caseId: null, messages: [], reply: null });

		const listed = await json<{ chats: AutoChat[] }>(`/apps/${app.id}/auto/chats`);
		expect(listed.body.chats.map((chat) => chat.id)).toEqual([second.body.id, first.body.id]);

		const opened = await json<AutoChat>(`/auto/chats/${first.body.id}`);
		expect(opened.body.id).toBe(first.body.id);

		expect(
			(await routes.request(`/auto/chats/${first.body.id}`, { method: "DELETE" })).status,
		).toBe(204);
		expect((await json(`/auto/chats/${first.body.id}`)).status).toBe(404);
		const after = await json<{ chats: AutoChat[] }>(`/apps/${app.id}/auto/chats`);
		expect(after.body.chats.map((chat) => chat.id)).toEqual([second.body.id]);
	});

	test("deleting a chat ends its open streams", async () => {
		const app = await createApp({ name: "Deleted" });
		const chat = await newChat(app.id);
		const stream = await openEvents(chat.id);

		await routes.request(`/auto/chats/${chat.id}`, { method: "DELETE" });

		expect(await stream.ended()).toBe(true);
	});

	test("a body that is not JSON is refused", async () => {
		const app = await createApp({ name: "Bad JSON" });
		const chat = await newChat(app.id);

		for (const path of [`/apps/${app.id}/auto/chats`, `/auto/chats/${chat.id}/messages`]) {
			const refused = await json<{ error: string }>(path, { method: "POST", body: "{nope" });
			expect(refused).toEqual({ status: 400, body: { error: "Invalid JSON body" } });
		}
		const patched = await json<{ error: string }>(`/auto/chats/${chat.id}`, {
			method: "PATCH",
			body: "{nope",
		});
		expect(patched.status).toBe(400);
	});

	test("Chat about this case starts the chat on that Test Case, shown in its header", async () => {
		const app = await createApp({ name: "About a case" });
		const login = await createCase(app.id, { name: "Login works" });
		const other = await createApp({ name: "Someone else's" });
		const elsewhere = await createCase(other.id, { name: "Not ours" });

		const chat = await newChat(app.id, login.id);
		expect(chat).toMatchObject({
			caseId: login.id,
			caseNumber: login.number,
			caseName: "Login works",
		});

		const refused = await json<{ error: string }>(`/apps/${app.id}/auto/chats`, {
			method: "POST",
			body: JSON.stringify({ caseId: elsewhere.id }),
		});
		expect(refused.status).toBe(400);
	});

	test("a reply streams over the chat's SSE stream, and the chat keeps both messages", async () => {
		const app = await createApp({ name: "Streams" });
		const chat = await newChat(app.id);
		agent.script = async function* () {
			yield { type: "text", delta: "The last run " };
			yield { type: "text", delta: "failed at step 3." };
		};
		const stream = await openEvents(chat.id);

		const sent = await send(chat.id, "Why did the last run fail?");
		expect(sent.status).toBe(202);
		const events = await stream.until(isReply);
		await stream.close();

		expect(events.map((event) => event.type)).toEqual([
			"message",
			"chat",
			"text",
			"text",
			"message",
		]);
		expect(events.filter((event) => event.type === "text").map((event) => event.delta)).toEqual([
			"The last run ",
			"failed at step 3.",
		]);
		const opened = await json<AutoChat>(`/auto/chats/${chat.id}`);
		expect(opened.body.title).toBe("Why did the last run fail?");
		expect(opened.body.reply).toBeNull();
		expect(
			opened.body.messages.map((message) => [message.role, message.mode, message.text]),
		).toEqual([
			["user", "ask", "Why did the last run fail?"],
			["assistant", null, "The last run failed at step 3."],
		]);
		expect(agent.turns[0]?.prompt).toContain("Why did the last run fail?");
	});

	test("the next message resumes the chat agent's session", async () => {
		const app = await createApp({ name: "Resumes" });
		const chat = await newChat(app.id);
		agent.script = async function* () {
			yield { type: "agent_session", agentSessionId: "sess_first" };
			yield { type: "text", delta: "Hi" };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Hello");
		await stream.until(isReply);
		await send(chat.id, "And again");
		await stream.until((event) => isReply(event) && stream.events.filter(isReply).length === 2);
		await stream.close();

		expect(agent.turns.map((turn) => turn.agentSessionId)).toEqual([null, "sess_first"]);
	});

	test("Ask mode offers only the read tools and refuses the Case draft's; Run mode offers both", async () => {
		const app = await createApp({ name: "Ask only" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [{ instructions: "Open the app", expectedResult: "It opens" }],
		});
		const chat = await newChat(app.id, login.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		const removal = { step: 1, reason: "Not needed" };
		agent.script = async function* (turn) {
			outputs.push(await turn.callTool("remove_draft_step", removal));
			yield { type: "text", delta: "I can only read here." };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Remove step 1");
		const events = await stream.until(isReply);
		agent.script = async function* () {
			yield { type: "text", delta: "Ready." };
		};
		await send(chat.id, "Get ready", "run");
		await stream.until(() => stream.events.filter(isReply).length === 2);
		await stream.close();

		const readTools = ["get_test_case", "list_runs", "get_run", "set_test_case", "get_case_draft"];
		expect(agent.turns.map((turn) => turn.tools.map((tool) => tool.name))).toEqual([
			readTools,
			[...readTools, "set_draft_steps", "add_draft_step", "change_draft_step", "remove_draft_step"],
		]);
		const refusal = "remove_draft_step is not available in Ask mode.";
		expect(outputs).toEqual([{ text: refusal, isError: true }]);
		expect(events.map((event) => event.type)).toContain("tool_call");
		expect(events.map((event) => event.type)).not.toContain("draft");
		const reply = events.find(isReply);
		expect(reply?.type === "message" && reply.message.toolCalls).toEqual([
			{
				id: expect.any(String),
				name: "remove_draft_step",
				input: removal,
				output: refusal,
				isError: true,
			},
		]);
		expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft).toBeNull();
	});

	test("in Run mode the agent writes a Case draft, saved with the chat and pushed over SSE, and the saved Test Case keeps its steps", async () => {
		const app = await createApp({ name: "Drafts" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [
				{ instructions: "Open the app", expectedResult: "The welcome screen shows" },
				{ instructions: "Tap Sign in", expectedResult: "The login form shows" },
				{ instructions: "Type the password", expectedResult: "Logged in" },
			],
		});
		const chat = await newChat(app.id, login.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		agent.script = async function* (turn) {
			outputs.push(
				await turn.callTool("change_draft_step", {
					step: 2,
					instructions: "Tap Log in",
					reason: "The button was renamed",
				}),
			);
			outputs.push(
				await turn.callTool("add_draft_step", {
					instructions: "Tap Continue",
					expectedResult: "The home screen shows",
					reason: "A new screen after login",
				}),
			);
			outputs.push(
				await turn.callTool("remove_draft_step", { step: 1, reason: "The app opens on its own" }),
			);
			yield { type: "text", delta: "Drafted." };
		};
		const stream = await openEvents(chat.id);

		expect((await send(chat.id, "Fix it", "run")).status).toBe(202);
		const events = await stream.until(isReply);
		await stream.close();

		expect(outputs.map((output) => output.isError)).toEqual([false, false, false]);
		expect(outputs[2]?.text).toBe(
			[
				`Case draft of #${login.number} Login works:`,
				"1. Tap Log in (changed: The button was renamed)",
				"   Expected: The login form shows",
				"2. Type the password",
				"   Expected: Logged in",
				"3. Tap Continue (added: A new screen after login)",
				"   Expected: The home screen shows",
				"Removed: Open the app (The app opens on its own)",
			].join("\n"),
		);
		const [saved1, saved2, saved3] = login.flows as [CaseFlowStep, CaseFlowStep, CaseFlowStep];
		const expected = {
			caseId: login.id,
			base: login.flows,
			steps: [
				{ ...saved2, instructions: "Tap Log in", reason: "The button was renamed" },
				{ ...saved3, reason: null },
				{
					id: expect.any(String),
					instructions: "Tap Continue",
					expectedResult: "The home screen shows",
					flowId: null,
					reason: "A new screen after login",
				},
			],
			removed: [{ before: saved1, reason: "The app opens on its own" }],
			updatedAt: expect.any(Number),
		};
		const drafts = events.filter((event) => event.type === "draft");
		expect(drafts).toHaveLength(3);
		expect(drafts.at(-1)).toEqual({ type: "draft", draft: expected });
		expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft).toEqual(expected);
		expect((await getCase(login.id))?.flows).toEqual(login.flows);
	});

	test("set_draft_steps writes the whole Case draft: a step naming its saved step rewrites it, one written as saved stays, saved steps left out are removed", async () => {
		const app = await createApp({ name: "Whole drafts" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [
				{ instructions: "Open the app", expectedResult: "The welcome screen shows" },
				{ instructions: "Tap Sign in", expectedResult: "The login form shows" },
				{ instructions: "Type the password", expectedResult: "Logged in" },
			],
		});
		const chat = await newChat(app.id, login.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		agent.script = async function* (turn) {
			outputs.push(
				await turn.callTool("set_draft_steps", {
					reason: "Login moved behind a menu",
					steps: [
						{ instructions: "Open the app", expectedResult: "The welcome screen shows" },
						{ instructions: "Open the menu", expectedResult: "The menu shows" },
						{ instructions: "Tap Log in", expectedResult: "The login form shows", savedStep: 2 },
					],
				}),
			);
			outputs.push(
				await turn.callTool("change_draft_step", {
					step: 3,
					instructions: "Tap Sign in",
					reason: "Back as it was",
				}),
			);
			outputs.push(await turn.callTool("remove_draft_step", { step: 9, reason: "Gone" }));
			yield { type: "text", delta: "Drafted." };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Fix it", "run");
		await stream.until(isReply);
		await stream.close();

		const [saved1, saved2, saved3] = login.flows as [CaseFlowStep, CaseFlowStep, CaseFlowStep];
		expect(outputs.map((output) => output.isError)).toEqual([false, false, true]);
		expect(outputs[2]?.text).toBe("There is no step 9: the Case draft has 3 steps.");
		const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
		expect(draft?.steps).toEqual([
			{ ...saved1, reason: null },
			{
				id: expect.any(String),
				instructions: "Open the menu",
				expectedResult: "The menu shows",
				flowId: null,
				reason: "Login moved behind a menu",
			},
			{ ...saved2, reason: null },
		]);
		expect(draft?.removed).toEqual([{ before: saved3, reason: "Login moved behind a menu" }]);
	});

	test("a step moved out of its saved order shows as moved, and a removed step added back is that step again", async () => {
		const app = await createApp({ name: "Moves" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [
				{ instructions: "Open the app", expectedResult: "It opens" },
				{ instructions: "Tap Sign in", expectedResult: "The form shows" },
				{ instructions: "Type the password", expectedResult: "Logged in" },
			],
		});
		const [open, signIn, password] = login.flows as [CaseFlowStep, CaseFlowStep, CaseFlowStep];
		const chat = await newChat(app.id, login.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		const drafts: unknown[] = [];
		agent.script = async function* (turn) {
			outputs.push(
				await turn.callTool("set_draft_steps", {
					reason: "Reordered",
					steps: [
						{ ...password, reason: "The password comes first now" },
						{ instructions: open.instructions, expectedResult: open.expectedResult },
						{ instructions: signIn.instructions, expectedResult: signIn.expectedResult },
					],
				}),
			);
			drafts.push((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft?.steps);
			outputs.push(await turn.callTool("remove_draft_step", { step: 1, reason: "Not needed" }));
			outputs.push(
				await turn.callTool("add_draft_step", {
					instructions: password.instructions,
					expectedResult: password.expectedResult,
					reason: "Needed after all",
				}),
			);
			yield { type: "text", delta: "Done." };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Reorder", "run");
		await stream.until(isReply);
		await stream.close();

		expect(outputs.map((output) => output.isError)).toEqual([false, false, false]);
		expect(outputs[0]?.text.split("\n")[1]).toBe(
			"1. Type the password (moved: The password comes first now)",
		);
		expect(drafts[0]).toEqual([
			{ ...password, reason: "The password comes first now" },
			{ ...open, reason: null },
			{ ...signIn, reason: null },
		]);
		const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
		expect(draft?.steps).toEqual(login.flows.map((step) => ({ ...step, reason: null })));
		expect(draft?.removed).toEqual([]);
	});

	test("a saved step named by number is never taken by another step written like it", async () => {
		const app = await createApp({ name: "Claims" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [
				{ instructions: "Open the app", expectedResult: "It opens" },
				{ instructions: "Tap Sign in", expectedResult: "The form shows" },
			],
		});
		const [open, signIn] = login.flows as [CaseFlowStep, CaseFlowStep];
		const chat = await newChat(app.id, login.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		agent.script = async function* (turn) {
			outputs.push(
				await turn.callTool("set_draft_steps", {
					reason: "Sign in twice",
					steps: [
						{ instructions: signIn.instructions, expectedResult: signIn.expectedResult },
						{ instructions: open.instructions, expectedResult: open.expectedResult },
						{ instructions: "Tap Sign in again", expectedResult: "Still signed in", savedStep: 2 },
					],
				}),
			);
			yield { type: "text", delta: "Done." };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Sign in twice", "run");
		await stream.until(isReply);
		await stream.close();

		expect(outputs[0]?.isError).toBe(false);
		const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
		expect(draft?.steps.map((step) => [step.id, step.instructions, step.reason])).toEqual([
			[expect.stringMatching(/^cf_/), "Tap Sign in", "Sign in twice"],
			[open.id, "Open the app", null],
			[signIn.id, "Tap Sign in again", "Sign in twice"],
		]);
	});

	test("the Case draft needs the chat's Test Case", async () => {
		const app = await createApp({ name: "No case yet" });
		const chat = await newChat(app.id);
		const outputs: Array<{ text: string; isError: boolean }> = [];
		agent.script = async function* (turn) {
			outputs.push(
				await turn.callTool("add_draft_step", {
					instructions: "Open the app",
					expectedResult: "It opens",
					reason: "A first step",
				}),
			);
			outputs.push(await turn.callTool("get_case_draft", {}));
			yield { type: "text", delta: "Which case?" };
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Add a step", "run");
		await stream.until(isReply);
		await stream.close();

		const noCase =
			"This chat has no Test Case yet, so there is no Case draft. Set one with set_test_case first.";
		expect(outputs).toEqual([
			{ text: noCase, isError: true },
			{ text: noCase, isError: true },
		]);
	});

	test("the agent sets the chat's Test Case once, and a second attempt is refused", async () => {
		const app = await createApp({ name: "Sets its case" });
		const login = await createCase(app.id, { name: "Login works" });
		const signup = await createCase(app.id, { name: "Sign up" });
		const outputs: Array<{ text: string; isError: boolean }> = [];
		agent.script = async function* (turn) {
			outputs.push(await turn.callTool("set_test_case", { number: login.number }));
			outputs.push(await turn.callTool("set_test_case", { number: signup.number }));
			yield { type: "text", delta: "Working on it." };
		};
		const chat = await newChat(app.id);
		const stream = await openEvents(chat.id);

		await send(chat.id, `Fix #${login.number}`);
		const events = await stream.until(isReply);
		await stream.close();

		expect(outputs.map((output) => output.isError)).toEqual([false, true]);
		expect(outputs[1]?.text).toContain("already works on");
		const header = events.filter((event) => event.type === "chat").at(-1);
		expect(header?.type === "chat" && header.chat.caseNumber).toBe(login.number);
		expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.caseId).toBe(login.id);
	});

	test("reads a Test Case's Runs and their steps as text, for the agent to explain", async () => {
		const app = await createApp({ name: "Reads runs" });
		const login = await createCase(app.id, {
			name: "Login works",
			flows: [{ instructions: "Sign in as demo", expectedResult: "The home screen shows" }],
		});
		const db = getCatalogDb();
		await db.insert(runs).values({
			id: "run_failed",
			appId: app.id,
			deviceId: "emulator-5554",
			platform: "android",
			status: "errored",
			executionMode: "agent",
			createdAt: 1_700_000_000_000,
		});
		await db.insert(runTests).values({
			id: "rtest_failed",
			runId: "run_failed",
			caseId: login.id,
			status: "errored",
			executionMode: "agent",
			error: "The password field never appeared",
		});
		await db.insert(runSteps).values({
			id: "rstep_1",
			runTestId: "rtest_failed",
			idx: 0,
			actionJson: JSON.stringify({ type: "tap", reason: "open the sign-in form" }),
			ok: 0,
			detail: "Nothing changed on screen",
			command: "yoqa tap --x 196 --y 488",
			createdAt: 1_700_000_000_500,
		});
		const outputs: string[] = [];
		agent.script = async function* (turn) {
			outputs.push((await turn.callTool("get_test_case", {})).text);
			outputs.push((await turn.callTool("list_runs", {})).text);
			outputs.push((await turn.callTool("get_run", { runId: "run_failed" })).text);
			yield { type: "text", delta: "Step 1 did nothing." };
		};
		const chat = await newChat(app.id, login.id);
		const stream = await openEvents(chat.id);

		await send(chat.id, "Why did the last run fail?");
		await stream.until(isReply);
		await stream.close();

		expect(outputs[0]).toContain("1. Sign in as demo\n   Expected: The home screen shows");
		expect(outputs[1]).toContain("run_failed · errored");
		expect(outputs[1]).toContain("The password field never appeared");
		expect(outputs[2]).toContain(
			"1. FAILED tap: open the sign-in form — Nothing changed on screen [yoqa tap --x 196 --y 488]",
		);
	});

	test("with the Claude Provider not signed in, a message is refused and nothing else answers", async () => {
		const app = await createApp({ name: "Signed out" });
		const chat = await newChat(app.id);
		agent.signedIn = false;

		expect((await json<{ signedIn: boolean }>("/auto/status")).body.signedIn).toBe(false);
		const sent = await send(chat.id, "Hello?");
		expect(sent.status).toBe(409);
		expect(sent.body.error).toContain("Claude Provider");
		expect(agent.turns).toEqual([]);
		expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.messages).toEqual([]);
	});

	test("lists the Claude Provider's models, and the chat's chosen model answers its turns", async () => {
		const app = await createApp({ name: "Picks a model" });
		const chat = await newChat(app.id);
		const listed = await json<{ models: Array<{ id: string }> }>("/auto/models");
		expect(listed.body.models.map((model) => model.id)).toEqual(["claude-opus-5-5"]);

		const updated = await json<AutoChat>(`/auto/chats/${chat.id}`, {
			method: "PATCH",
			body: JSON.stringify({ model: "claude-opus-5-5" }),
		});
		expect(updated.body.model).toBe("claude-opus-5-5");
		const stream = await openEvents(chat.id);
		await send(chat.id, "Hello");
		await stream.until(isReply);
		await stream.close();

		expect(agent.turns[0]?.model).toBe("claude-opus-5-5");
	});

	test("Explore does not answer yet, and one reply at a time", async () => {
		const app = await createApp({ name: "One at a time" });
		const chat = await newChat(app.id);
		expect((await send(chat.id, "Look around", "explore")).status).toBe(400);

		const { promise: held, resolve: release } = Promise.withResolvers<void>();
		agent.script = async function* () {
			await held;
			yield { type: "text", delta: "Done" };
		};
		const stream = await openEvents(chat.id);
		expect((await send(chat.id, "First")).status).toBe(202);
		expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.reply).toEqual({
			text: "",
			toolCalls: [],
		});
		expect((await send(chat.id, "Second")).status).toBe(409);
		release();
		await stream.until(isReply);
		expect((await send(chat.id, "Third")).status).toBe(202);
		await stream.until(() => stream.events.filter(isReply).length === 2);
		await stream.close();
	});

	test("a reply the agent cannot finish is kept with its reason", async () => {
		const app = await createApp({ name: "Fails" });
		const chat = await newChat(app.id);
		agent.script = async function* () {
			yield { type: "text", delta: "Looking" };
			throw new Error("The Claude Provider is rate limited.");
		};
		const stream = await openEvents(chat.id);

		await send(chat.id, "Hello");
		const reply = (await stream.until(isReply)).find(isReply);
		await stream.close();

		expect(reply?.type === "message" && [reply.message.text, reply.message.error]).toEqual([
			"Looking",
			"The Claude Provider is rate limited.",
		]);
	});
});
