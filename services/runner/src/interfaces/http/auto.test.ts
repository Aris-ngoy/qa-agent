import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	type AutoChat,
	type AutoChatEvent,
	type AutoRun,
	type CaseFlowStep,
	type CaseHistory,
	type CaseScript,
	type ListAutoModelsResponse,
	type Run,
	type SendAutoMessageResponse,
	autoChatEventSchema,
} from "@yoqa/runner-client";
import { eq, ne } from "drizzle-orm";
import type { ChatAgent, ChatAgentEvent, ChatTurn } from "../../domains/auto/chat-agent";
import { createRoutingChatAgent } from "../../domains/auto/routing-agent";
import {
	createApp,
	createCase,
	createFlow,
	getCase,
	listCases,
	saveCaseScript,
	updateCase,
	updateFlow,
} from "../../domains/catalog/application";
import { closeCatalogDb, getCatalogDb, openCatalogDb } from "../../domains/catalog/db";
import {
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
} from "../../domains/devices/active-session";
import { type FakeAxNode, type FakeCdp, startFakeCdp } from "../../domains/devices/fake-cdp";
import { providers } from "../../domains/providers/schema";
import { getRun } from "../../domains/runs/application";
import {
	type FakeVision,
	addFakeVisionProvider,
	startFakeVision,
} from "../../domains/runs/fake-vision";
import { runSteps, runTests, runs } from "../../domains/runs/schema";
import { createAutoRoutes } from "./auto";
import { createRunsRoutes } from "./runs";
import { createSessionRoutes } from "./session";

/**
 * The chat agent the routes get: the real routing over the catalog's Providers, with each turn
 * answered by running `script` (whichever agent the Provider routes to), the Claude CLI login
 * faked, and each Provider listing two models of its kind. It records the turns it was given,
 * and which agent answered each.
 */
type ScriptedAgent = ChatAgent & {
	claudeCliSignedIn: boolean;
	turns: ChatTurn[];
	answeredBy: Array<"claude" | "ai-sdk">;
	script: (turn: ChatTurn) => AsyncGenerator<ChatAgentEvent>;
};

function scriptedAgent(): ScriptedAgent {
	const state = {
		claudeCliSignedIn: true,
		turns: [] as ChatTurn[],
		answeredBy: [] as Array<"claude" | "ai-sdk">,
		script: async function* (_turn: ChatTurn): AsyncGenerator<ChatAgentEvent> {
			yield { type: "text", delta: "Hello" };
		},
	};
	const answer = (by: "claude" | "ai-sdk", turn: ChatTurn) => {
		state.turns.push(turn);
		state.answeredBy.push(by);
		return state.script(turn);
	};
	const routing = createRoutingChatAgent({
		claude: { runTurn: (turn) => answer("claude", turn) },
		aiSdk: { runTurn: (turn) => answer("ai-sdk", turn) },
		probeClaudeCli: async () =>
			state.claudeCliSignedIn
				? { signedIn: true, detail: "Authenticated via Claude CLI" }
				: {
						signedIn: false,
						detail: "`claude` found but not authenticated — run `claude auth login`",
					},
		listModels: async (auth) => [
			{ id: `${auth.kind}-small`, name: `${auth.kind} small` },
			{ id: `${auth.kind}-large`, name: `${auth.kind} large` },
		],
	});
	return Object.assign(state, routing);
}

/** The fake vision Provider every test starts with: the app's default, and Chat-capable. */
const FAKE_VISION_ID = "prov_fake_vision";

/** Add a Provider row straight to the catalog (no key: a key would be encrypted with ~/.yoqa's). */
async function addProvider(
	row: Partial<typeof providers.$inferInsert> & Pick<typeof providers.$inferInsert, "id" | "kind">,
) {
	await getCatalogDb()
		.insert(providers)
		.values({ label: row.kind, createdAt: 1, updatedAt: 1, ...row });
}

const WEB_URL = "https://shop.example.com/";
/** Longer than the chat takes to read a Run in progress again for its Run card. */
const FOLLOW_WAIT_MS = 400;

describe("the Auto chat routes", () => {
	let agent: ScriptedAgent;
	let routes: ReturnType<typeof createAutoRoutes>;
	let vision: FakeVision;
	let catalogPath: string;

	beforeAll(async () => {
		closeCatalogDb();
		const dir = await mkdtemp(`${tmpdir()}/auto-`);
		catalogPath = `${dir}/catalog.db`;
		openCatalogDb(catalogPath);
		process.env.YOQA_AUTO_CHATS_DIR = `${dir}/chats`;
		vision = startFakeVision();
		await addFakeVisionProvider(vision);
	});
	afterAll(() => {
		vision.stop();
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
		return json<SendAutoMessageResponse & { error?: string }>(`/auto/chats/${chatId}/messages`, {
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
			outputs.push(await turn.callTool("run_case_draft", {}));
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

		const readTools = [
			"get_test_case",
			"list_runs",
			"get_run",
			"get_history",
			"set_test_case",
			"get_case_draft",
		];
		expect(agent.turns.map((turn) => turn.tools.map((tool) => tool.name))).toEqual([
			readTools,
			[
				...readTools,
				"set_draft_steps",
				"add_draft_step",
				"change_draft_step",
				"remove_draft_step",
				"run_case_draft",
			],
		]);
		const refusal = "remove_draft_step is not available in Ask mode.";
		expect(outputs).toEqual([
			{ text: refusal, isError: true },
			{ text: "run_case_draft is not available in Ask mode.", isError: true },
		]);
		expect(events.map((event) => event.type)).toContain("tool_call");
		expect(events.map((event) => event.type)).not.toContain("draft");
		const reply = events.find(isReply);
		expect(reply?.type === "message" && reply.message.toolCalls[0]).toEqual({
			id: expect.any(String),
			name: "remove_draft_step",
			input: removal,
			output: refusal,
			isError: true,
		});
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
			passingRunId: null,
			learnedScript: null,
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

	test("the chat's chosen model answers its turns", async () => {
		const app = await createApp({ name: "Picks a model" });
		const chat = await newChat(app.id);

		const updated = await json<AutoChat>(`/auto/chats/${chat.id}`, {
			method: "PATCH",
			body: JSON.stringify({ model: "custom-large" }),
		});
		expect(updated.body.model).toBe("custom-large");
		const stream = await openEvents(chat.id);
		await send(chat.id, "Hello");
		await stream.until(isReply);
		await stream.close();

		expect(agent.turns[0]?.model).toBe("custom-large");
	});

	test("one reply at a time", async () => {
		const app = await createApp({ name: "One at a time" });
		const chat = await newChat(app.id);

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
	describe("Chat-capable Providers", () => {
		afterEach(async () => {
			// Back to the fake vision Provider alone, the app's default.
			await getCatalogDb().delete(providers).where(ne(providers.id, FAKE_VISION_ID));
			await getCatalogDb()
				.update(providers)
				.set({ enabled: 1, isDefault: 1 })
				.where(eq(providers.id, FAKE_VISION_ID));
		});

		const claudeCli = { id: "prov_claude", kind: "claude", label: "Claude", authMode: "cli" };
		const codexCli = { id: "prov_codex", kind: "codex", label: "Codex", authMode: "cli" };

		test("Auto is signed in while any Chat-capable Provider is, and names them; with none, a message is refused", async () => {
			const one = await json<{ signedIn: boolean; detail: string }>("/auto/status");
			expect(one.body).toEqual({ signedIn: true, detail: "Can chat on Fake vision." });

			await addProvider(claudeCli);
			await addProvider(codexCli);
			const several = await json<{ signedIn: boolean; detail: string }>("/auto/status");
			expect(several.body).toEqual({ signedIn: true, detail: "Can chat on Fake vision, Claude." });

			agent.claudeCliSignedIn = false;
			await getCatalogDb()
				.update(providers)
				.set({ enabled: 0 })
				.where(eq(providers.id, FAKE_VISION_ID));
			const none = await json<{ signedIn: boolean; detail: string }>("/auto/status");
			expect(none.body.signedIn).toBe(false);
			expect(none.body.detail).toContain("Settings → Providers");

			const app = await createApp({ name: "Signed out" });
			const chat = await newChat(app.id);
			const sent = await send(chat.id, "Hello?");
			expect(sent.status).toBe(409);
			expect(sent.body.error).toContain("Provider that can chat");
			expect(agent.turns).toEqual([]);
		});

		test("lists the models of every Provider, grouped, and marks a CLI login that cannot chat unavailable with why", async () => {
			await addProvider(claudeCli);
			await addProvider({ ...codexCli, createdAt: 2 });
			await addProvider({ id: "prov_no_url", kind: "custom", label: "Gateway", createdAt: 3 });
			await addProvider({
				id: "prov_off",
				kind: "custom",
				label: "Off",
				enabled: 0,
				baseUrl: "http://x",
			});

			const listed = await json<ListAutoModelsResponse>("/auto/models");

			expect(listed.body.defaultProviderId).toBe(FAKE_VISION_ID);
			expect(listed.body.providers).toEqual([
				{
					id: FAKE_VISION_ID,
					kind: "custom",
					label: "Fake vision",
					available: true,
					reason: null,
					models: [
						{ id: "custom-small", name: "custom small" },
						{ id: "custom-large", name: "custom large" },
					],
					defaultModel: "fake-vision",
				},
				{
					id: "prov_claude",
					kind: "claude",
					label: "Claude",
					available: true,
					reason: null,
					models: [
						{ id: "claude-small", name: "claude small" },
						{ id: "claude-large", name: "claude large" },
					],
					defaultModel: null,
				},
				{
					id: "prov_codex",
					kind: "codex",
					label: "Codex",
					available: false,
					reason:
						"Codex's CLI login cannot run the Auto chat yet; add an OpenAI API key to Codex in Settings → Providers.",
					models: [],
					defaultModel: "gpt-4o",
				},
				{
					id: "prov_no_url",
					kind: "custom",
					label: "Gateway",
					available: false,
					reason: "It has no Base URL.",
					models: [],
					defaultModel: null,
				},
			]);
		});

		test("a new chat starts on the app's default Provider when it can chat, else on the first that can", async () => {
			const app = await createApp({ name: "Defaults" });
			expect((await newChat(app.id)).providerId).toBe(FAKE_VISION_ID);

			await addProvider({ ...claudeCli, createdAt: 2 });
			await addProvider({ ...codexCli, createdAt: 3 });
			await getCatalogDb().update(providers).set({ isDefault: 0 });
			await getCatalogDb()
				.update(providers)
				.set({ isDefault: 1 })
				.where(eq(providers.id, "prov_claude"));
			expect((await newChat(app.id)).providerId).toBe("prov_claude");

			// The default cannot chat (a CLI login only Claude can chat on yet): the first that can.
			await getCatalogDb().update(providers).set({ isDefault: 0 });
			await getCatalogDb()
				.update(providers)
				.set({ isDefault: 1 })
				.where(eq(providers.id, "prov_codex"));
			expect((await newChat(app.id)).providerId).toBe(FAKE_VISION_ID);
		});

		test("switching the model keeps the agent's own history; switching the Provider starts the new one from the visible conversation, pushed as a chat event", async () => {
			await addProvider(claudeCli);
			const app = await createApp({ name: "Switches" });
			const chat = await newChat(app.id);
			agent.script = async function* (turn) {
				yield { type: "agent_history", agentHistory: `history after: ${turn.prompt}` };
				if (turn.prompt.includes("Read #8")) await turn.callTool("get_test_case", {});
				yield { type: "text", delta: `Answer ${agent.turns.length}` };
			};
			const stream = await openEvents(chat.id);
			const replies = (count: number) => () => stream.events.filter(isReply).length === count;

			await send(chat.id, "Read #8");
			await stream.until(replies(1));
			const modelSwitch = await json<AutoChat>(`/auto/chats/${chat.id}`, {
				method: "PATCH",
				body: JSON.stringify({ model: "custom-large" }),
			});
			expect(modelSwitch.body).toMatchObject({ providerId: FAKE_VISION_ID, model: "custom-large" });
			await send(chat.id, "Second");
			await stream.until(replies(2));

			const providerSwitch = await json<AutoChat>(`/auto/chats/${chat.id}`, {
				method: "PATCH",
				body: JSON.stringify({ providerId: "prov_claude", model: "claude-large" }),
			});
			expect(providerSwitch.body).toMatchObject({
				providerId: "prov_claude",
				model: "claude-large",
			});
			await stream.until(
				(event) => event.type === "chat" && event.chat.providerId === "prov_claude",
			);
			await send(chat.id, "Third");
			await stream.until(replies(3));
			await stream.close();

			expect(agent.answeredBy).toEqual(["ai-sdk", "ai-sdk", "claude"]);
			const [first, second, third] = agent.turns;
			expect(first).toMatchObject({
				providerId: FAKE_VISION_ID,
				model: "fake-vision",
				conversation: null,
				agentHistory: null,
			});
			expect(second).toMatchObject({
				providerId: FAKE_VISION_ID,
				model: "custom-large",
				conversation: null,
				agentHistory: "history after: [Ask mode] Read #8",
			});
			expect(third).toMatchObject({
				providerId: "prov_claude",
				model: "claude-large",
				agentHistory: null,
				agentSessionId: null,
			});
			expect(third?.conversation?.split("\n")).toEqual([
				"User (Ask mode): Read #8",
				"Agent: Answer 1",
				expect.stringMatching(/^ {2}\[tool get_test_case: (done|refused or failed)/),
				"User (Ask mode): Second",
				"Agent: Answer 2",
			]);
		});

		test("a Provider that cannot chat, or is not set up, is refused, and the chat stays where it was", async () => {
			await addProvider(codexCli);
			const app = await createApp({ name: "Refuses" });
			const chat = await newChat(app.id);

			const cli = await json<{ error: string }>(`/auto/chats/${chat.id}`, {
				method: "PATCH",
				body: JSON.stringify({ providerId: "prov_codex" }),
			});
			expect(cli.status).toBe(400);
			expect(cli.body.error).toContain("Codex's CLI login cannot run the Auto chat yet");

			const unknown = await json<{ error: string }>(`/auto/chats/${chat.id}`, {
				method: "PATCH",
				body: JSON.stringify({ providerId: "prov_nowhere" }),
			});
			expect(unknown.status).toBe(400);
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.providerId).toBe(FAKE_VISION_ID);
		});

		test("a chat whose Provider was removed or disabled answers its next message with why, and asks for another", async () => {
			await addProvider({ id: "prov_gone", kind: "custom", label: "Gone", baseUrl: "http://gone" });
			await addProvider({
				id: "prov_paused",
				kind: "custom",
				label: "Paused",
				baseUrl: "http://paused",
			});
			const app = await createApp({ name: "Lost its Provider" });
			const removed = await newChat(app.id);
			const disabled = await newChat(app.id);
			for (const [chat, providerId] of [
				[removed, "prov_gone"],
				[disabled, "prov_paused"],
			] as const) {
				await json(`/auto/chats/${chat.id}`, {
					method: "PATCH",
					body: JSON.stringify({ providerId }),
				});
			}
			await getCatalogDb().delete(providers).where(eq(providers.id, "prov_gone"));
			await getCatalogDb()
				.update(providers)
				.set({ enabled: 0 })
				.where(eq(providers.id, "prov_paused"));

			for (const [chat, expected] of [
				[
					removed,
					"The Provider this chat was on was removed. Pick another Provider in the composer.",
				],
				[
					disabled,
					"This chat's Provider, Paused, is disabled in Settings → Providers. Pick another Provider in the composer.",
				],
			] as const) {
				const stream = await openEvents(chat.id);
				expect((await send(chat.id, "Hello")).status).toBe(202);
				const reply = (await stream.until(isReply)).find(isReply);
				await stream.close();
				expect(reply?.type === "message" && reply.message.error).toBe(expected);
			}
			expect(agent.turns).toEqual([]);
		});

		test("chats from before keep the Claude Provider and its session, or have none when there was no Claude Provider", async () => {
			const migrated = await mkdtemp(`${tmpdir()}/auto-migrated-`);
			const old = new Database(`${migrated}/catalog.db`, { create: true });
			old.exec(`
				CREATE TABLE apps (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
				CREATE TABLE providers (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, auth_mode TEXT NOT NULL DEFAULT 'api_key', enabled INTEGER NOT NULL DEFAULT 1, binary_path TEXT, accent_color TEXT NOT NULL DEFAULT 'blue', server_url TEXT, base_url TEXT, default_model TEXT, is_default INTEGER NOT NULL DEFAULT 0, api_key_ciphertext TEXT, api_key_last4 TEXT, env_ciphertext TEXT, status TEXT NOT NULL DEFAULT 'unchecked', status_detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
				CREATE TABLE auto_chats (id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, case_id TEXT, title TEXT NOT NULL, model TEXT, sdk_session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
				INSERT INTO apps (id, name, created_at, updated_at) VALUES ('app_old', 'Old', 1, 1);
				INSERT INTO providers (id, kind, label, auth_mode, is_default, created_at, updated_at) VALUES ('prov_openai', 'openai', 'OpenAI', 'api_key', 1, 1, 1);
				INSERT INTO providers (id, kind, label, auth_mode, created_at, updated_at) VALUES ('prov_claude_old', 'claude', 'Claude', 'cli', 2, 2);
				INSERT INTO auto_chats (id, app_id, title, model, sdk_session_id, created_at, updated_at) VALUES ('chat_old', 'app_old', 'Old chat', 'opus', 'sess_old', 1, 1);
			`);
			old.close();
			const without = await mkdtemp(`${tmpdir()}/auto-migrated-none-`);
			const none = new Database(`${without}/catalog.db`, { create: true });
			none.exec(`
				CREATE TABLE providers (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, auth_mode TEXT NOT NULL DEFAULT 'api_key', enabled INTEGER NOT NULL DEFAULT 1, binary_path TEXT, accent_color TEXT NOT NULL DEFAULT 'blue', server_url TEXT, base_url TEXT, default_model TEXT, is_default INTEGER NOT NULL DEFAULT 0, api_key_ciphertext TEXT, api_key_last4 TEXT, env_ciphertext TEXT, status TEXT NOT NULL DEFAULT 'unchecked', status_detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
				CREATE TABLE auto_chats (id TEXT PRIMARY KEY NOT NULL, app_id TEXT NOT NULL, case_id TEXT, title TEXT NOT NULL, model TEXT, sdk_session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
				INSERT INTO auto_chats (id, app_id, title, created_at, updated_at) VALUES ('chat_none', 'app_old', 'No Claude', 1, 1);
			`);
			none.close();

			closeCatalogDb();
			try {
				openCatalogDb(`${migrated}/catalog.db`);
				expect((await json<AutoChat>("/auto/chats/chat_old")).body).toMatchObject({
					providerId: "prov_claude_old",
					model: "opus",
				});
				const stream = await openEvents("chat_old");
				await send("chat_old", "Still there?");
				await stream.until(isReply);
				await stream.close();
				expect(agent.turns[0]).toMatchObject({
					providerId: "prov_claude_old",
					agentSessionId: "sess_old",
					conversation: null,
				});
				expect(agent.answeredBy).toEqual(["claude"]);
				closeCatalogDb();

				openCatalogDb(`${without}/catalog.db`);
				expect((await json<AutoChat>("/auto/chats/chat_none")).body.providerId).toBeNull();
			} finally {
				closeCatalogDb();
				openCatalogDb(catalogPath);
			}
		});
	});
	describe("running the Case draft", () => {
		let browser: FakeCdp;

		/** A browser to run on, showing `nodes`, connected as the device the chat uses. */
		async function connectBrowser(nodes?: FakeAxNode[]): Promise<string> {
			browser = startFakeCdp({ viewport: { width: 1280, height: 800 }, nodes });
			const deviceId = `chromium-cdp-${browser.port}`;
			await connectDevice({ deviceId, platform: "web" });
			return deviceId;
		}

		afterEach(async () => {
			for (let attempt = 0; attempt < 500 && getActiveSessionInfo()?.heldByRun; attempt++) {
				await Bun.sleep(10);
			}
			await disconnectDevice();
			browser?.kill();
			vision.prompts = [];
			vision.failWith = null;
			vision.continues = 0;
			vision.held = null;
			vision.holdOn = null;
			vision.deciding = false;
		});

		const SAVED_SCRIPT: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", x: 100, y: 100, reason: "the saved tap" }],
		};

		/** A web App with a saved, never-run Test Case that has a Case Script, and a chat on it. */
		async function chatOnSavedCase(name: string) {
			const app = await createApp({ name, webUrl: WEB_URL });
			const saved = await createCase(app.id, {
				name: "Checkout",
				flows: [{ instructions: "Tap Pay", expectedResult: "The receipt shows" }],
			});
			await saveCaseScript(saved.id, JSON.stringify(SAVED_SCRIPT), SAVED_SCRIPT.savedAt);
			const chat = await newChat(app.id, saved.id);
			return { app, saved: (await getCase(saved.id)) ?? saved, chat };
		}

		const fixPay = {
			step: 1,
			instructions: "Tap Pay now",
			reason: "The button was renamed",
		};

		test("Run mode runs the whole draft's steps, answers a text summary, and records the passing Run on the draft, leaving the saved case alone", async () => {
			await connectBrowser();
			const { saved, chat } = await chatOnSavedCase("Runs its draft");
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "It passes now." };
			};
			const stream = await openEvents(chat.id);

			expect((await send(chat.id, "Fix it and run it", "run")).status).toBe(202);
			await stream.until(isReply);
			await stream.close();

			expect(outputs).toHaveLength(1);
			const [output] = outputs as [{ text: string; isError: boolean }];
			expect(output.isError).toBe(false);
			const runId = output.text.match(/Run (run_\S+)/)?.[1] as string;
			expect(output.text).toContain(`Run ${runId} · passed`);
			expect(output.text).toContain("1. ok tap: tap the middle");
			expect(output.text).not.toMatch(/base64|data:image|\.png/);
			expect(vision.prompts.join("\n")).toContain("Tap Pay now");
			expect(vision.prompts.join("\n")).not.toContain("Tap Pay\n");

			const run = await getRun(runId);
			expect(run.status).toBe("passed");
			expect(run.tests.map((item) => item.caseId)).toEqual([saved.id]);
			const after = await getCase(saved.id);
			expect(after?.script).toEqual(SAVED_SCRIPT);
			expect(after?.scriptSavedAt).toBe(saved.scriptSavedAt);
			expect(after?.lastRunStatus).toBeNull();
			expect(after?.lastRunAt).toBeNull();

			const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
			expect(draft?.passingRunId).toBe(runId);
			expect(draft?.learnedScript?.actions).toEqual([
				expect.objectContaining({ type: "tap", x: 500, y: 500 }),
			]);
		});

		test("with a default Provider that cannot see, as Claude, the Run decides on the first enabled one that can", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Claude is the default");
			await getCatalogDb()
				.update(providers)
				.set({ isDefault: 0 })
				.where(eq(providers.id, FAKE_VISION_ID));
			await addProvider({
				id: "prov_claude",
				kind: "claude",
				authMode: "cli",
				isDefault: 1,
				createdAt: -1,
			});
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Ran it." };
			};
			const stream = await openEvents(chat.id);

			await send(chat.id, "Run it", "run");
			const cards = runCards(await stream.until(isReply));
			await stream.close();
			await getCatalogDb().delete(providers).where(eq(providers.id, "prov_claude"));
			await getCatalogDb()
				.update(providers)
				.set({ isDefault: 1 })
				.where(eq(providers.id, FAKE_VISION_ID));

			expect(outputs[0]?.text).not.toContain("does not support vision");
			expect(outputs[0]?.text).toContain("· passed");
			expect(cards.at(-1)?.provider).toBe("Fake vision · fake-vision");
		});

		const runCards = (events: AutoChatEvent[]): AutoRun[] =>
			events.flatMap((event) => (event.type === "run" ? [event.run] : []));

		test("the Run card streams over SSE with each step's status and commands and the vision Provider, and the Run is listed labelled with its chat", async () => {
			await connectBrowser();
			const { app, chat } = await chatOnSavedCase("Run card");
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				await turn.callTool("add_draft_step", {
					instructions: "Tap Done",
					expectedResult: "The shop shows",
					reason: "A new last screen",
				});
				await turn.callTool("run_case_draft", {});
				yield { type: "text", delta: "Ran it." };
			};
			const stream = await openEvents(chat.id);
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			vision.holdOn = "Tap Done";

			await send(chat.id, "Fix it and run it", "run");
			// Held at the first Decide of step 2: the Run card has step 1 done and step 2 running.
			for (let attempt = 0; attempt < 500 && !vision.deciding; attempt++) await Bun.sleep(10);
			await Bun.sleep(FOLLOW_WAIT_MS);
			const live = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body.run;
			release();
			const cards = runCards(await stream.until(isReply));
			await stream.close();

			expect(live).toMatchObject({ status: "running", currentStep: 2 });
			expect(live?.steps.map((step) => step.status)).toEqual(["passed", "running"]);
			expect(cards.some((card) => card.currentStep === 2)).toBe(true);
			const last = cards.at(-1) as AutoRun;
			expect(last).toMatchObject({
				status: "passed",
				executionMode: "agent",
				provider: "Fake vision · fake-vision",
				currentStep: null,
				error: null,
			});
			expect(last.startedAt).toEqual(expect.any(Number));
			expect(last.finishedAt).toEqual(expect.any(Number));
			expect(last.steps.map((step) => [step.instructions, step.status])).toEqual([
				["Tap Pay now", "passed"],
				["Tap Done", "passed"],
			]);
			for (const step of last.steps) {
				expect(step.commands).toEqual([expect.stringContaining("tap")]);
			}
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.run).toBeNull();

			const runsRoutes = createRunsRoutes();
			const listed = (await (await runsRoutes.request(`/runs?appId=${app.id}`)).json()) as {
				runs: Run[];
			};
			expect(listed.runs.map((run) => [run.id, run.autoChat])).toEqual([
				[last.runId, { id: chat.id, title: "Fix it and run it" }],
			]);
			const detail = (await (await runsRoutes.request(`/runs/${last.runId}`)).json()) as Run;
			expect(detail.autoChat).toEqual({ id: chat.id, title: "Fix it and run it" });
			expect(detail.tests[0]?.steps?.length).toBeGreaterThan(0);
		});

		test("the chat's Run in progress shows in its case's History as in progress, with the draft's steps, and counts once it ends", async () => {
			await connectBrowser();
			const { saved, chat } = await chatOnSavedCase("History of a live run");
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				await turn.callTool("add_draft_step", {
					instructions: "Tap Done",
					expectedResult: "The shop shows",
					reason: "A new last screen",
				});
				await turn.callTool("run_case_draft", {});
				yield { type: "text", delta: "Ran it." };
			};
			const stream = await openEvents(chat.id);
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			vision.holdOn = "Tap Done";
			const history = async () =>
				(await (
					await createRunsRoutes().request(`/cases/${saved.id}/history`)
				).json()) as CaseHistory;

			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			const live = await history();
			release();
			await stream.until(isReply);
			await stream.close();
			const ended = await history();

			expect(live).toMatchObject({ passed: 0, failed: 0, averagePassMs: null, note: null });
			expect(live.runs).toEqual([
				expect.objectContaining({
					number: 1,
					status: "running",
					autoChat: { id: chat.id, title: "Fix it and run it" },
					durationMs: null,
					currentStep: 2,
					failedStep: null,
					// The draft's two steps, not the saved case's one.
					steps: ["passed", "running"],
				}),
			]);
			expect(ended).toMatchObject({ passed: 1, failed: 0 });
			expect(ended.runs[0]).toMatchObject({
				status: "passed",
				currentStep: null,
				steps: ["passed", "passed"],
			});
			expect(ended.runs[0]?.durationMs).toEqual(expect.any(Number));
			expect(ended.averagePassMs).toBe(ended.runs[0]?.durationMs as number);
		});

		test("Stop cancels the chat's Run through the Run's own cancel, and the agent hears it stopped", async () => {
			await connectBrowser();
			const { saved, chat } = await chatOnSavedCase("Stopped");
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Stopped." };
			};
			const stream = await openEvents(chat.id);

			expect((await json(`/auto/chats/${chat.id}/run/stop`, { method: "POST" })).status).toBe(409);
			await send(chat.id, "Fix it and run it", "run");
			for (let attempt = 0; attempt < 500 && !vision.deciding; attempt++) await Bun.sleep(10);
			await Bun.sleep(FOLLOW_WAIT_MS);
			const live = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body.run;
			const stopped = await routes.request(`/auto/chats/${chat.id}/run/stop`, { method: "POST" });
			expect(stopped.status).toBe(204);
			release();
			const cards = runCards(await stream.until(isReply));
			await stream.close();

			expect(live?.status).toBe("running");
			expect(cards.at(-1)?.status).toBe("cancelled");
			expect(cards.at(-1)?.steps[0]?.status).toBe("stopped");
			expect(outputs[0]?.text).toContain("· cancelled");
			expect(outputs[0]?.text).toContain("The Run was stopped before it ended.");
			expect((await getRun(live?.runId as string)).status).toBe("cancelled");
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft?.passingRunId).toBeNull();
			expect((await getCase(saved.id))?.lastRunStatus).toBeNull();
		});

		/** Wait until `check` holds, up to five seconds. */
		async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
			for (let attempt = 0; attempt < 500 && !(await check()); attempt++) await Bun.sleep(10);
		}

		const control = (chatId: string, action: "pause" | "take-over" | "resume") =>
			json<AutoChat & { error?: string }>(`/auto/chats/${chatId}/run/${action}`, {
				method: "POST",
			});

		const shownRun = async (chatId: string) =>
			(await json<AutoChat>(`/auto/chats/${chatId}`)).body.run;

		test("Pause stops the Run before its next Action and keeps it open, over SSE, and Resume carries on from where it paused", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Paused");
			// One tap: the first verify says the step is not done yet.
			vision.continues = 1;
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Ran it." };
			};
			const stream = await openEvents(chat.id);

			expect((await control(chat.id, "pause")).status).toBe(409);
			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			const pausing = await control(chat.id, "pause");
			expect(pausing.status).toBe(200);
			expect(pausing.body.run?.pause).toBe("pausing");
			release();
			await waitUntil(async () => (await shownRun(chat.id))?.pause === "paused");
			await Bun.sleep(FOLLOW_WAIT_MS);
			const paused = await shownRun(chat.id);
			// The tap it decided on waits for Resume.
			expect(paused).toMatchObject({ status: "running", pause: "paused" });
			expect(browser.clicks).toEqual([]);
			expect(vision.prompts).toHaveLength(1);

			const resumed = await control(chat.id, "resume");
			expect(resumed.status).toBe(200);
			expect(resumed.body.run?.pause).toBeNull();
			const cards = runCards(await stream.until(isReply));
			await stream.close();

			expect(browser.clicks).toEqual([{ x: 640, y: 400 }]);
			const states = cards
				.map((card) => card.pause)
				.filter((state, index, all) => state !== all[index - 1]);
			expect(states).toEqual([null, "pausing", "paused", null]);
			expect(outputs[0]?.text).toContain("· passed");
			// A pause alone leaves the Run clean: it is the draft's passing Run.
			const runId = cards.at(-1)?.runId;
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft?.passingRunId).toBe(
				runId as string,
			);
			expect((await control(chat.id, "resume")).status).toBe(409);
		});

		test("Take over pauses and hands the device to the user; their Actions are not recorded, the Run goes on from the screen they left, and it does not count as a passing Run", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Taken over");
			vision.continues = 1;
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Ran it." };
			};
			const stream = await openEvents(chat.id);
			const session = createSessionRoutes();
			const tapByHand = () =>
				session.request("/action", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ kind: "tap", x: 100, y: 100 }),
				});

			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			// While the Run drives, the device is view only.
			expect((await tapByHand()).status).toBe(409);
			const taking = await control(chat.id, "take-over");
			expect(taking.status).toBe(200);
			expect(taking.body.run?.pause).toBe("pausing");
			release();
			await waitUntil(async () => (await shownRun(chat.id))?.pause === "taken_over");
			expect(getActiveSessionInfo()).toMatchObject({ heldByRun: true, takenOver: true });
			expect((await tapByHand()).status).toBe(200);
			expect(browser.clicks).toEqual([{ x: 128, y: 80 }]);

			expect((await control(chat.id, "resume")).status).toBe(200);
			const cards = runCards(await stream.until(isReply));
			await stream.close();

			expect(cards.some((card) => card.pause === "taken_over")).toBe(true);
			expect(getActiveSessionInfo()?.takenOver).toBe(false);
			// The tap decided before the Take over is dropped: the agent looked at the screen the
			// user left and decided again, and that screen already passed.
			expect(browser.clicks).toEqual([{ x: 128, y: 80 }]);
			expect(vision.prompts).toHaveLength(2);
			const runId = cards.at(-1)?.runId as string;
			const run = await getRun(runId);
			expect(run.status).toBe("passed");
			for (const step of run.tests[0]?.steps ?? []) {
				expect(step.action).not.toMatchObject({ x: 100, y: 100 });
			}
			expect(outputs[0]?.text).toContain("· passed");
			expect(outputs[0]?.text).toContain("The user took over this Run");
			const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
			expect(draft).toMatchObject({ passingRunId: null, learnedScript: null });
			expect(draft?.steps.map((step) => step.instructions)).toEqual(["Tap Pay now"]);
		});

		test("Stop while taken over ends the Run and hands the device back; with no Run in progress there is nothing to pause, take over or resume", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Stopped while taken over");
			vision.continues = 1;
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Stopped." };
			};
			const stream = await openEvents(chat.id);

			for (const action of ["pause", "take-over", "resume"] as const) {
				const refused = await control(chat.id, action);
				expect(refused.status).toBe(409);
				expect(refused.body.error).toBe("No Run of this chat is in progress.");
			}
			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			expect((await control(chat.id, "resume")).body.error).toBe("The Run is not paused.");
			await control(chat.id, "take-over");
			release();
			await waitUntil(async () => (await shownRun(chat.id))?.pause === "taken_over");
			const stopped = await routes.request(`/auto/chats/${chat.id}/run/stop`, { method: "POST" });
			expect(stopped.status).toBe(204);
			const cards = runCards(await stream.until(isReply));
			await stream.close();

			expect(cards.at(-1)).toMatchObject({ status: "cancelled", pause: null });
			expect(outputs[0]?.text).toContain("The Run was stopped before it ended.");
			expect(outputs[0]?.text).toContain("The user took over this Run");
			await waitUntil(() => getActiveSessionInfo()?.heldByRun === false);
			expect(getActiveSessionInfo()).toMatchObject({ heldByRun: false, takenOver: false });
		});

		const queuedTexts = (chat: AutoChat) => chat.queue.map((queued) => queued.text);

		/** The id of a message `send` queued. */
		function queuedId(sent: { body: SendAutoMessageResponse }): string {
			if (sent.body.type !== "queued") throw new Error(`Not queued: ${JSON.stringify(sent.body)}`);
			return sent.body.queued.id;
		}

		/** The first turn runs the draft; each later one just replies. */
		function runThenReply(): void {
			agent.script = async function* (turn) {
				const number = agent.turns.length;
				if (number === 1) {
					await turn.callTool("change_draft_step", fixPay);
					await turn.callTool("run_case_draft", {});
				}
				yield { type: "text", delta: `Reply ${number}` };
			};
		}

		test("messages sent during the chat's Run are queued in order, over SSE, and go to the agent together as one turn once the Run ends", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Queued");
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			runThenReply();
			const stream = await openEvents(chat.id);

			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			const first = await send(chat.id, "Then check the receipt", "run");
			const second = await send(chat.id, "And why did it fail before?", "ask");
			expect(first.status).toBe(202);
			expect(first.body).toMatchObject({
				type: "queued",
				queued: { text: "Then check the receipt", mode: "run" },
			});
			expect(second.body.type).toBe("queued");
			const during = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
			expect(queuedTexts(during)).toEqual([
				"Then check the receipt",
				"And why did it fail before?",
			]);
			expect(during.messages.map((message) => message.text)).toEqual(["Fix it and run it"]);
			expect(agent.turns).toHaveLength(1);

			release();
			const events = await stream.until(() => stream.events.filter(isReply).length === 2);
			await stream.close();

			const queues = events.flatMap((event) =>
				event.type === "queue" ? [event.queue.map((queued) => queued.text)] : [],
			);
			expect(queues).toEqual([
				["Then check the receipt"],
				["Then check the receipt", "And why did it fail before?"],
				[],
			]);
			expect(agent.turns).toHaveLength(2);
			const delivered = agent.turns[1] as ChatTurn;
			expect(delivered.prompt).toMatch(/Then check the receipt[\s\S]*And why did it fail before\?/);
			// Sent together, the turn takes the narrowest of their modes: Ask, which reads only.
			expect(delivered.mode).toBe("ask");
			expect(delivered.tools.map((tool) => tool.name)).not.toContain("run_case_draft");
			const after = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
			expect(after.queue).toEqual([]);
			expect(after.messages.map((message) => [message.role, message.text])).toEqual([
				["user", "Fix it and run it"],
				["assistant", "Reply 1"],
				["user", "Then check the receipt"],
				["user", "And why did it fail before?"],
				["assistant", "Reply 2"],
			]);
		});

		test("a queued message can be removed before it is sent, and stopping the Run keeps the queue", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Queue kept");
			const { promise: held, resolve: release } = Promise.withResolvers<void>();
			vision.held = held;
			runThenReply();
			const stream = await openEvents(chat.id);

			await send(chat.id, "Fix it and run it", "run");
			await waitUntil(() => vision.deciding);
			await send(chat.id, "Keep this", "run");
			const dropped = queuedId(await send(chat.id, "Not this", "run"));
			const removed = await json<AutoChat>(`/auto/chats/${chat.id}/queue/${dropped}`, {
				method: "DELETE",
			});
			expect(removed.status).toBe(200);
			expect(queuedTexts(removed.body)).toEqual(["Keep this"]);
			const again = await json(`/auto/chats/${chat.id}/queue/${dropped}`, { method: "DELETE" });
			expect(again.status).toBe(404);

			const stopped = await routes.request(`/auto/chats/${chat.id}/run/stop`, { method: "POST" });
			expect(stopped.status).toBe(204);
			expect(queuedTexts((await json<AutoChat>(`/auto/chats/${chat.id}`)).body)).toEqual([
				"Keep this",
			]);
			release();
			await stream.until(() => stream.events.filter(isReply).length === 2);
			await stream.close();

			expect(runCards(stream.events).at(-1)?.status).toBe("cancelled");
			expect(agent.turns).toHaveLength(2);
			expect(agent.turns[1]?.prompt).toContain("Keep this");
			expect(agent.turns[1]?.prompt).not.toContain("Not this");
			expect(agent.turns[1]?.mode).toBe("run");
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.queue).toEqual([]);
		});

		test("any change to the draft after its passing Run clears the pass and its Case Script", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("Cleared");
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				await turn.callTool("run_case_draft", {});
				yield { type: "text", delta: "Passed." };
			};
			const stream = await openEvents(chat.id);
			await send(chat.id, "Fix it and run it", "run");
			await stream.until(isReply);
			expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft?.passingRunId).toEqual(
				expect.any(String),
			);

			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", {
					step: 1,
					expectedResult: "The receipt and a thank-you show",
					reason: "Clearer",
				});
				yield { type: "text", delta: "Changed." };
			};
			await send(chat.id, "Say more in step 1", "run");
			const events = await stream.until(() => stream.events.filter(isReply).length === 2);
			await stream.close();

			const lastDraft = events.filter((event) => event.type === "draft").at(-1);
			expect(lastDraft?.type === "draft" && lastDraft.draft).toMatchObject({
				passingRunId: null,
				learnedScript: null,
			});
			const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
			expect(draft).toMatchObject({ passingRunId: null, learnedScript: null });
		});

		test("a chat runs one draft Run at a time: a second call while one runs is refused", async () => {
			await connectBrowser();
			const { chat } = await chatOnSavedCase("One Run at a time");
			let outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				await turn.callTool("change_draft_step", fixPay);
				outputs = await Promise.all([
					turn.callTool("run_case_draft", {}),
					turn.callTool("run_case_draft", {}),
				]);
				yield { type: "text", delta: "Ran once." };
			};
			const stream = await openEvents(chat.id);

			await send(chat.id, "Run it twice", "run");
			await stream.until(isReply);
			await stream.close();

			expect(outputs.map((output) => output.isError)).toEqual([false, true]);
			expect(outputs[0]?.text).toContain("· passed");
			expect(outputs[1]?.text).toBe(
				"A Run of this Case draft is already in progress. Wait for it to end.",
			);
		});

		test("running needs a connected device and a draft", async () => {
			const { chat } = await chatOnSavedCase("Nothing to run on");
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				outputs.push(await turn.callTool("run_case_draft", {}));
				await turn.callTool("change_draft_step", fixPay);
				outputs.push(await turn.callTool("run_case_draft", {}));
				yield { type: "text", delta: "Cannot." };
			};
			const stream = await openEvents(chat.id);

			await send(chat.id, "Run it", "run");
			await stream.until(isReply);
			await stream.close();

			expect(outputs.map((output) => output.isError)).toEqual([true, true]);
			expect(outputs[0]?.text).toContain("There is no Case draft of");
			expect(outputs[1]?.text).toContain("No device is connected");
		});

		describe("applying the Case draft", () => {
			/** Have the agent write the draft (`fixPay`), and run it when `run` is set. */
			async function writeDraft(chatId: string, run: boolean) {
				agent.script = async function* (turn) {
					await turn.callTool("change_draft_step", fixPay);
					if (run) await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "Done." };
				};
				const stream = await openEvents(chatId);
				await send(chatId, "Fix it", "run");
				await stream.until(isReply);
				await stream.close();
				return (await json<AutoChat>(`/auto/chats/${chatId}`)).body.draft;
			}

			const apply = (chatId: string) =>
				json<AutoChat & { error?: string }>(`/auto/chats/${chatId}/draft/apply`, {
					method: "POST",
				});

			test("Apply on a draft with no passing Run is refused with why, and the Test Case is unchanged", async () => {
				const { saved, chat } = await chatOnSavedCase("Not passed yet");
				const draft = await writeDraft(chat.id, false);
				expect(draft?.passingRunId).toBeNull();

				const applied = await apply(chat.id);

				expect(applied.status).toBe(409);
				expect(applied.body.error).toContain("passing Run");
				const after = await getCase(saved.id);
				expect(after?.flows).toEqual(saved.flows);
				expect(after?.script).toEqual(SAVED_SCRIPT);
				expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft).toEqual(draft);
			});

			test("Apply on a passed draft saves its steps and learned Case Script together, keeps the replaced ones as the previous version, and the case then replays with no Provider call", async () => {
				const deviceId = await connectBrowser();
				const { app, saved, chat } = await chatOnSavedCase("Applied");
				const draft = await writeDraft(chat.id, true);
				expect(draft?.passingRunId).toEqual(expect.any(String));
				const stream = await openEvents(chat.id);

				const applied = await apply(chat.id);
				const events = await stream.until((event) => event.type === "previous_version");
				await stream.close();

				expect(applied.status).toBe(200);
				const after = await getCase(saved.id);
				expect(after?.flows).toEqual([
					{
						id: saved.flows[0]?.id as string,
						instructions: "Tap Pay now",
						expectedResult: "The receipt shows",
						flowId: null,
					},
				]);
				expect(after?.script?.actions).toEqual(draft?.learnedScript?.actions);
				expect(after?.script?.actions).not.toEqual(SAVED_SCRIPT.actions);
				expect(applied.body.draft).toBeNull();
				expect(applied.body.previousVersion).toMatchObject({
					steps: saved.flows,
					hasScript: true,
				});
				expect(events).toContainEqual({ type: "draft", draft: null });
				expect(events.at(-1)).toEqual({
					type: "previous_version",
					previousVersion: applied.body.previousVersion,
				});

				// Decide fails the Run if it is called at all.
				vision.failWith = "Decide must not be called";
				vision.prompts = [];
				const runsRoutes = createRunsRoutes();
				const started = await runsRoutes.request("/runs", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						appId: app.id,
						caseIds: [saved.id],
						deviceId,
						platform: "web",
						executionMode: "script",
					}),
				});
				expect(started.status).toBe(201);
				const { id: runId } = (await started.json()) as Run;
				let replayed = await getRun(runId);
				for (let attempt = 0; attempt < 500; attempt++) {
					replayed = await getRun(runId);
					if (replayed.status !== "queued" && replayed.status !== "running") break;
					await Bun.sleep(10);
				}
				expect(replayed.status).toBe("passed");
				expect(replayed.tests[0]?.executionMode).toBe("script");
				expect(vision.prompts).toEqual([]);
			});

			test("✕ on a step removes it from the draft and clears the pass, over SSE, and Apply is refused until the draft passes again", async () => {
				await connectBrowser();
				const { saved, chat } = await chatOnSavedCase("Step removed");
				agent.script = async function* (turn) {
					await turn.callTool("change_draft_step", fixPay);
					await turn.callTool("add_draft_step", {
						instructions: "Tap Done",
						expectedResult: "The shop shows",
						reason: "A new last screen",
					});
					await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "Passed." };
				};
				let stream = await openEvents(chat.id);
				await send(chat.id, "Fix it and run it", "run");
				const passed = (await stream.until(isReply))
					.flatMap((event) => (event.type === "draft" ? [event.draft] : []))
					.at(-1);
				expect(passed?.passingRunId).toEqual(expect.any(String));
				const added = passed?.steps[1]?.id as string;

				const removed = await json<AutoChat>(`/auto/chats/${chat.id}/draft/steps/${added}`, {
					method: "DELETE",
				});
				const event = (await stream.until((item) => item.type === "draft")).at(-1);
				await stream.close();

				expect(removed.status).toBe(200);
				expect(removed.body.draft?.steps.map((step) => step.instructions)).toEqual(["Tap Pay now"]);
				expect(removed.body.draft).toMatchObject({ passingRunId: null, learnedScript: null });
				expect(event?.type === "draft" && event.draft).toEqual(removed.body.draft);
				expect((await apply(chat.id)).status).toBe(409);
				expect((await getCase(saved.id))?.flows).toEqual(saved.flows);
				expect(
					(await json(`/auto/chats/${chat.id}/draft/steps/cf_missing`, { method: "DELETE" }))
						.status,
				).toBe(404);

				agent.script = async function* (turn) {
					await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "Passed again." };
				};
				stream = await openEvents(chat.id);
				await send(chat.id, "Run it again", "run");
				await stream.until(isReply);
				await stream.close();
				expect((await apply(chat.id)).status).toBe(200);
				expect((await getCase(saved.id))?.flows.map((step) => step.instructions)).toEqual([
					"Tap Pay now",
				]);
			});

			test("Apply is refused when the Test Case was edited since the draft started, keeping the edit", async () => {
				await connectBrowser();
				const { saved, chat } = await chatOnSavedCase("Edited meanwhile");
				await writeDraft(chat.id, true);
				const edit = [{ instructions: "Tap Checkout", expectedResult: "The basket shows" }];
				await updateCase(saved.id, { flows: edit });

				const applied = await apply(chat.id);

				expect(applied.status).toBe(409);
				expect(applied.body.error).toContain("edited since the Case draft started");
				const after = await getCase(saved.id);
				expect(after?.flows.map((step) => step.instructions)).toEqual(["Tap Checkout"]);
				expect(after?.script).toEqual(SAVED_SCRIPT);
				expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.previousVersion).toBeNull();
			});

			test("editing a reusable Flow the case uses does not block Apply, and the applied step stays linked to it", async () => {
				await connectBrowser();
				const app = await createApp({ name: "Flow edited", webUrl: WEB_URL });
				const flow = await createFlow(app.id, {
					name: "Open the shop",
					instructions: "Open the shop",
					expectedResult: "The shop shows",
				});
				const saved = await createCase(app.id, {
					name: "Shop",
					flows: [
						{ flowId: flow.id },
						{ instructions: "Tap Pay", expectedResult: "The receipt shows" },
					],
				});
				const chat = await newChat(app.id, saved.id);
				agent.script = async function* (turn) {
					await turn.callTool("change_draft_step", { ...fixPay, step: 2 });
					await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "Passed." };
				};
				const stream = await openEvents(chat.id);
				await send(chat.id, "Fix it and run it", "run");
				await stream.until(isReply);
				await stream.close();
				await updateFlow(flow.id, { instructions: "Open the shop's home page" });

				const applied = await apply(chat.id);

				expect(applied.status).toBe(200);
				const after = await getCase(saved.id);
				expect(after?.flows.map((step) => [step.flowId, step.instructions])).toEqual([
					[flow.id, "Open the shop's home page"],
					[null, "Tap Pay now"],
				]);
			});

			test("Reject all throws the draft away, over SSE, and the Test Case is unchanged", async () => {
				const { saved, chat } = await chatOnSavedCase("Rejected");
				await writeDraft(chat.id, false);
				const stream = await openEvents(chat.id);

				const rejected = await json<AutoChat>(`/auto/chats/${chat.id}/draft`, {
					method: "DELETE",
				});
				const events = await stream.until((event) => event.type === "draft");
				await stream.close();

				expect(rejected.status).toBe(200);
				expect(rejected.body.draft).toBeNull();
				expect(events.at(-1)).toEqual({ type: "draft", draft: null });
				expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.draft).toBeNull();
				const after = await getCase(saved.id);
				expect(after?.flows).toEqual(saved.flows);
				expect(after?.script).toEqual(SAVED_SCRIPT);
				expect((await json(`/auto/chats/${chat.id}/draft`, { method: "DELETE" })).status).toBe(404);
			});

			test("Restore previous version swaps the current and previous steps and Case Script, and restoring twice returns to the applied version", async () => {
				await connectBrowser();
				const { saved, chat } = await chatOnSavedCase("Restored");
				const restore = () =>
					json<AutoChat & { error?: string }>(`/auto/chats/${chat.id}/previous-version/restore`, {
						method: "POST",
					});
				const none = await restore();
				expect(none.status).toBe(409);
				expect(none.body.error).toContain("no previous version");

				await writeDraft(chat.id, true);
				await apply(chat.id);
				const applied = await getCase(saved.id);
				const stream = await openEvents(chat.id);

				const first = await restore();
				const events = await stream.until((event) => event.type === "previous_version");
				await stream.close();

				expect(first.status).toBe(200);
				const restored = await getCase(saved.id);
				expect(restored?.flows).toEqual(saved.flows);
				expect(restored?.script).toEqual(SAVED_SCRIPT);
				expect(restored?.scriptSavedAt).toBe(saved.scriptSavedAt);
				expect(first.body.previousVersion).toMatchObject({
					steps: applied?.flows,
					hasScript: true,
				});
				expect(events.at(-1)).toEqual({
					type: "previous_version",
					previousVersion: first.body.previousVersion,
				});

				expect((await restore()).status).toBe(200);
				const again = await getCase(saved.id);
				expect(again?.flows).toEqual(applied?.flows);
				expect(again?.script).toEqual(applied?.script);
				expect(again?.scriptSavedAt).toBe(applied?.scriptSavedAt);
			});
		});

		describe("Explore mode", () => {
			const EXPLORE_TOOLS = ["read_screen", "perform_action", "propose_test_case"];

			test("Explore offers the Run tools plus reading the Screen, acting and proposing a Test Case, which Ask and Run refuse", async () => {
				const app = await createApp({ name: "Explores", webUrl: WEB_URL });
				const chat = await newChat(app.id);
				const outputs: Array<{ text: string; isError: boolean }> = [];
				agent.script = async function* (turn) {
					if (turn.mode !== "explore") {
						for (const name of EXPLORE_TOOLS) outputs.push(await turn.callTool(name, {}));
					}
					yield { type: "text", delta: "Done." };
				};
				const stream = await openEvents(chat.id);

				for (const [index, mode] of (["ask", "run", "explore"] as const).entries()) {
					expect((await send(chat.id, `Message ${index + 1}`, mode)).status).toBe(202);
					await stream.until(() => stream.events.filter(isReply).length === index + 1);
				}
				await stream.close();

				const [, runTools, exploreTools] = agent.turns.map((turn) =>
					turn.tools.map((tool) => tool.name),
				);
				expect(exploreTools).toEqual([...(runTools ?? []), ...EXPLORE_TOOLS]);
				expect(agent.turns[2]?.prompt).toBe("[Explore mode] Message 3");
				expect(outputs).toEqual(
					["Ask", "Run"].flatMap((mode) =>
						EXPLORE_TOOLS.map((name) => ({
							text: `${name} is not available in ${mode} mode.`,
							isError: true,
						})),
					),
				);
			});

			test("the agent reads the Screen as text and acts on the device, and those Actions are in no Case draft and no Run", async () => {
				await connectBrowser([
					{ role: "heading", name: "Checkout", box: { x: 40, y: 40, width: 400, height: 40 } },
					{ role: "button", name: "Pay", box: { x: 600, y: 380, width: 80, height: 40 } },
				]);
				const { app, chat } = await chatOnSavedCase("Explores the device");
				const outputs: Array<{ text: string; isError: boolean }> = [];
				let draftBefore = "";
				agent.script = async function* (turn) {
					await turn.callTool("change_draft_step", fixPay);
					draftBefore = (await turn.callTool("get_case_draft", {})).text;
					outputs.push(await turn.callTool("read_screen", {}));
					outputs.push(await turn.callTool("perform_action", { kind: "tap", label: "Pay" }));
					outputs.push(await turn.callTool("perform_action", { kind: "tap", label: "Nope" }));
					outputs.push(await turn.callTool("get_case_draft", {}));
					yield { type: "text", delta: "Looked around." };
				};
				const stream = await openEvents(chat.id);

				await send(chat.id, "Look at the checkout", "explore");
				const events = await stream.until(isReply);
				await stream.close();

				const [screen, tapped, missed, draftAfter] = outputs as Array<{
					text: string;
					isError: boolean;
				}>;
				expect(screen?.isError).toBe(false);
				expect(screen?.text).toContain("Checkout");
				expect(screen?.text).toMatch(/\b\d+,\s*\d+\s+\d+x\d+\s+Pay\b/);
				expect(screen?.text).not.toMatch(/base64|data:image|\.png/);
				expect(tapped?.isError).toBe(false);
				expect(tapped?.text).toMatch(
					/^Done: tap on "Pay" at \d+,\d+\. Read the Screen to see what it did\.$/,
				);
				// One click, inside the Pay button (its centre, give or take the 0–1000 grid).
				expect(browser.clicks).toHaveLength(1);
				const [click] = browser.clicks as [{ x: number; y: number }];
				expect(click.x).toBeWithin(600, 680);
				expect(click.y).toBeWithin(380, 420);
				expect(missed).toEqual({ text: "No element matching label: Nope", isError: true });
				expect(draftAfter?.text).toBe(draftBefore);
				expect(events.filter((event) => event.type === "draft")).toHaveLength(1);
				const { draft } = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
				expect(draft?.steps.map((step) => step.instructions)).toEqual(["Tap Pay now"]);
				const listed = (await (
					await createRunsRoutes().request(`/runs?appId=${app.id}`)
				).json()) as {
					runs: Run[];
				};
				expect(listed.runs).toEqual([]);
			});

			const proposed = {
				name: "Pay at checkout",
				reason: "Paying is not tested yet",
				steps: [
					{ instructions: "Tap Pay", expectedResult: "The receipt shows" },
					{ instructions: "Tap Done", expectedResult: "The shop shows" },
				],
			};

			test("in a chat with no Test Case the agent proposes a new one, shown over SSE and with the chat; proposing again replaces it", async () => {
				const app = await createApp({ name: "Proposes", webUrl: WEB_URL });
				const chat = await newChat(app.id);
				const outputs: Array<{ text: string; isError: boolean }> = [];
				agent.script = async function* (turn) {
					outputs.push(await turn.callTool("propose_test_case", { ...proposed, name: "Pay" }));
					outputs.push(await turn.callTool("propose_test_case", proposed));
					yield { type: "text", delta: "Proposed." };
				};
				const stream = await openEvents(chat.id);

				await send(chat.id, "Find something to test", "explore");
				const events = await stream.until(isReply);
				await stream.close();

				expect(outputs.map((output) => output.isError)).toEqual([false, false]);
				expect(outputs[1]?.text).toBe(
					[
						'Proposed Test Case "Pay at checkout" (Paying is not tested yet):',
						"1. Tap Pay",
						"   Expected: The receipt shows",
						"2. Tap Done",
						"   Expected: The shop shows",
						"It shows in the Test tab: the user accepts it there to create it.",
					].join("\n"),
				);
				const proposals = events.flatMap((event) =>
					event.type === "proposal" ? [event.proposal] : [],
				);
				expect(proposals.map((proposal) => proposal?.name)).toEqual(["Pay", "Pay at checkout"]);
				const shown = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
				expect(shown.proposal).toEqual({ ...proposed, updatedAt: expect.any(Number) });
				expect(shown).toMatchObject({ caseId: null, draft: null });
			});

			/** A chat with no Test Case, on a web App, where the agent proposed `proposed`. */
			async function chatWithProposal(name: string) {
				const app = await createApp({ name, webUrl: WEB_URL });
				const chat = await newChat(app.id);
				agent.script = async function* (turn) {
					await turn.callTool("propose_test_case", proposed);
					yield { type: "text", delta: "Proposed." };
				};
				const stream = await openEvents(chat.id);
				await send(chat.id, "Find something to test", "explore");
				await stream.until(isReply);
				await stream.close();
				return { app, chat };
			}

			const accept = (chatId: string) =>
				json<AutoChat & { error?: string }>(`/auto/chats/${chatId}/proposal/accept`, {
					method: "POST",
				});

			test("accepting the proposal creates the Test Case with no steps as the chat's case, and its steps become the Case draft, which must pass before Apply", async () => {
				await connectBrowser();
				const { app, chat } = await chatWithProposal("Accepts");
				const stream = await openEvents(chat.id);

				const accepted = await accept(chat.id);
				const events = await stream.until((event) => event.type === "draft");
				expect(accepted.status).toBe(200);
				const caseId = accepted.body.caseId as string;
				const created = await getCase(caseId);
				expect(created).toMatchObject({ appId: app.id, name: "Pay at checkout", flows: [] });
				expect(accepted.body).toMatchObject({
					caseNumber: created?.number,
					caseName: "Pay at checkout",
					proposal: null,
				});
				expect(accepted.body.draft).toEqual({
					caseId,
					base: [],
					steps: proposed.steps.map((step) => ({
						...step,
						id: expect.any(String),
						flowId: null,
						reason: "Paying is not tested yet",
					})),
					removed: [],
					passingRunId: null,
					learnedScript: null,
					updatedAt: expect.any(Number),
				});
				expect(events.map((event) => event.type)).toEqual(["chat", "proposal", "draft"]);
				expect(events[0]).toMatchObject({ chat: { caseId, caseName: "Pay at checkout" } });
				expect(events[1]).toEqual({ type: "proposal", proposal: null });

				const early = await json<{ error: string }>(`/auto/chats/${chat.id}/draft/apply`, {
					method: "POST",
				});
				expect(early.status).toBe(409);

				agent.script = async function* (turn) {
					await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "It passes." };
				};
				await stream.close();
				const running = await openEvents(chat.id);
				await send(chat.id, "Run it", "run");
				await running.until(isReply);
				await running.close();
				const applied = await json<AutoChat>(`/auto/chats/${chat.id}/draft/apply`, {
					method: "POST",
				});
				expect(applied.status).toBe(200);
				const saved = await getCase(caseId);
				expect(saved?.flows.map((step) => step.instructions)).toEqual(["Tap Pay", "Tap Done"]);
				expect(saved?.script?.actions.length).toBeGreaterThan(0);
			});

			test("setting the chat's Test Case takes the proposal away, so there is nothing left to accept", async () => {
				const { app, chat } = await chatWithProposal("Accepts late");
				const login = await createCase(app.id, { name: "Login works" });
				agent.script = async function* (turn) {
					await turn.callTool("set_test_case", { number: login.number });
					yield { type: "text", delta: "Set." };
				};
				const stream = await openEvents(chat.id);
				await send(chat.id, "Work on the login case");
				const events = await stream.until(isReply);
				await stream.close();

				expect(events).toContainEqual({ type: "proposal", proposal: null });
				const shown = (await json<AutoChat>(`/auto/chats/${chat.id}`)).body;
				expect(shown).toMatchObject({ caseId: login.id, proposal: null });
				expect((await accept(chat.id)).status).toBe(404);
				expect((await listCases(app.id)).map((item) => item.name)).toEqual(["Login works"]);

				const other = await newChat(app.id);
				expect((await accept(other.id)).status).toBe(404);
			});

			test("Reject throws the proposal away, over SSE, and creates nothing", async () => {
				const { app, chat } = await chatWithProposal("Rejects");
				const stream = await openEvents(chat.id);

				const rejected = await json<AutoChat>(`/auto/chats/${chat.id}/proposal`, {
					method: "DELETE",
				});
				const events = await stream.until((event) => event.type === "proposal");
				await stream.close();

				expect(rejected.status).toBe(200);
				expect(rejected.body).toMatchObject({ proposal: null, caseId: null, draft: null });
				expect(events.at(-1)).toEqual({ type: "proposal", proposal: null });
				expect(await listCases(app.id)).toEqual([]);
				expect((await json(`/auto/chats/${chat.id}/proposal`, { method: "DELETE" })).status).toBe(
					404,
				);
			});

			test("a case proposed after exploring holds only the steps the agent wrote, not the Actions it took", async () => {
				await connectBrowser([
					{ role: "button", name: "Pay", box: { x: 600, y: 380, width: 80, height: 40 } },
				]);
				const app = await createApp({ name: "Explores, then proposes", webUrl: WEB_URL });
				const chat = await newChat(app.id);
				agent.script = async function* (turn) {
					await turn.callTool("read_screen", {});
					await turn.callTool("perform_action", { kind: "tap", label: "Pay" });
					await turn.callTool("perform_action", { kind: "input", text: "4242" });
					await turn.callTool("propose_test_case", proposed);
					yield { type: "text", delta: "Proposed." };
				};
				const stream = await openEvents(chat.id);
				await send(chat.id, "Find something to test", "explore");
				await stream.until(isReply);
				await stream.close();
				expect(browser.clicks).toHaveLength(1);

				const accepted = await accept(chat.id);

				expect(accepted.body.proposal).toBeNull();
				expect(
					accepted.body.draft?.steps.map(({ instructions, expectedResult }) => ({
						instructions,
						expectedResult,
					})),
				).toEqual(proposed.steps);
				expect(JSON.stringify(accepted.body.draft)).not.toContain("4242");
			});

			test("the device tools are refused while a Run holds the device", async () => {
				await connectBrowser();
				const { chat: running } = await chatOnSavedCase("Holds the device");
				const { promise: held, resolve: release } = Promise.withResolvers<void>();
				vision.held = held;
				agent.script = async function* (turn) {
					await turn.callTool("change_draft_step", fixPay);
					await turn.callTool("run_case_draft", {});
					yield { type: "text", delta: "Ran it." };
				};
				const runStream = await openEvents(running.id);
				await send(running.id, "Fix it and run it", "run");
				await waitUntil(() => vision.deciding);

				const explorer = await newChat((await createApp({ name: "Explores meanwhile" })).id);
				const outputs: Array<{ text: string; isError: boolean }> = [];
				agent.script = async function* (turn) {
					outputs.push(await turn.callTool("read_screen", {}));
					outputs.push(await turn.callTool("perform_action", { kind: "tap", x: 1, y: 1 }));
					yield { type: "text", delta: "Busy." };
				};
				const stream = await openEvents(explorer.id);
				await send(explorer.id, "Look around", "explore");
				await stream.until(isReply);
				await stream.close();
				release();
				await runStream.until(isReply);
				await runStream.close();

				const refusal = "A Run is using the device. Wait for it to end, then try again.";
				expect(outputs).toEqual([
					{ text: refusal, isError: true },
					{ text: refusal, isError: true },
				]);
			});

			test("a chat that has a Test Case cannot propose a new one", async () => {
				const app = await createApp({ name: "Has a case" });
				const login = await createCase(app.id, { name: "Login works" });
				const chat = await newChat(app.id, login.id);
				const outputs: Array<{ text: string; isError: boolean }> = [];
				agent.script = async function* (turn) {
					outputs.push(await turn.callTool("propose_test_case", proposed));
					yield { type: "text", delta: "Cannot." };
				};
				const stream = await openEvents(chat.id);

				await send(chat.id, "Propose a case", "explore");
				const events = await stream.until(isReply);
				await stream.close();

				expect(outputs).toEqual([
					{
						text: `This chat already works on #${login.number} Login works. It cannot propose a new one: a new Test Case needs a new chat.`,
						isError: true,
					},
				]);
				expect(events.map((event) => event.type)).not.toContain("proposal");
				expect((await json<AutoChat>(`/auto/chats/${chat.id}`)).body.proposal).toBeNull();
			});

			test("the device tools need a connected device", async () => {
				const app = await createApp({ name: "No device" });
				const chat = await newChat(app.id);
				const outputs: Array<{ text: string; isError: boolean }> = [];
				agent.script = async function* (turn) {
					outputs.push(await turn.callTool("read_screen", {}));
					outputs.push(await turn.callTool("perform_action", { kind: "tap", x: 1, y: 1 }));
					yield { type: "text", delta: "Nothing to see." };
				};
				const stream = await openEvents(chat.id);

				await send(chat.id, "Look around", "explore");
				await stream.until(isReply);
				await stream.close();

				const refusal = "No device is connected. Ask the user to connect one from the top bar.";
				expect(outputs).toEqual([
					{ text: refusal, isError: true },
					{ text: refusal, isError: true },
				]);
			});
		});
	});

	describe("the History summary", () => {
		const DAY = 24 * 60 * 60 * 1000;
		const NOW = Date.now();
		const STEPS = [
			{ instructions: "Open the payout screen", expectedResult: "" },
			{ instructions: "Enter 10", expectedResult: "" },
			{ instructions: "Tap Pay out", expectedResult: "The payout is sent" },
		];

		type SeededRun = {
			status: "passed" | "errored" | "cancelled" | "running";
			daysAgo: number;
			seconds?: number;
			/** The step (from 0) a Run that did not pass ended on. */
			endedAt?: number;
			steps?: Array<{ instructions: string; expectedResult: string }> | null;
			executionMode?: "agent" | "script";
			/** An agent Run that ended before its first step (the App would not start). */
			noSteps?: boolean;
		};

		/**
		 * A Run of `caseId` as the Run engine stores it: one agent step per step of the case
		 * up to where it ended, each verified but the last of a Run that did not pass.
		 */
		async function seedRun(appId: string, caseId: string, seeded: SeededRun): Promise<string> {
			const db = getCatalogDb();
			const id = `run_${Math.random().toString(36).slice(2)}`;
			const createdAt = NOW - seeded.daysAgo * DAY;
			const finishedAt =
				seeded.status === "running" ? null : createdAt + (seeded.seconds ?? 30) * 1000;
			await db.insert(runs).values({
				id,
				appId,
				deviceId: "emulator-5554",
				platform: "android",
				status: seeded.status,
				executionMode: "auto",
				createdAt,
				startedAt: createdAt,
				finishedAt,
			});
			await db.insert(runTests).values({
				id: `rtest_${id}`,
				runId: id,
				caseId,
				status: seeded.status,
				executionMode: seeded.executionMode ?? "agent",
				error: seeded.status === "errored" ? "It did not work" : null,
				startedAt: createdAt,
				finishedAt,
				stepsJson: seeded.steps === null ? null : JSON.stringify(seeded.steps ?? STEPS),
			});
			const ran = seeded.steps ?? STEPS;
			const last = seeded.status === "passed" ? ran.length - 1 : (seeded.endedAt ?? 0);
			if (seeded.executionMode === "script" || seeded.noSteps) return id;
			for (let flowStep = 0; flowStep <= last; flowStep++) {
				const done = seeded.status === "passed" || flowStep < last;
				await db.insert(runSteps).values({
					id: `rstep_${id}_${flowStep}`,
					runTestId: `rtest_${id}`,
					idx: flowStep,
					actionJson: JSON.stringify({
						type: "tap",
						flowStep,
						cycle: { verify: { type: done ? "verify" : "continue" } },
					}),
					ok: done || seeded.status !== "errored" ? 1 : 0,
					createdAt: createdAt + flowStep,
				});
			}
			return id;
		}

		async function caseWithRuns(name: string, seeded: SeededRun[]) {
			const app = await createApp({ name });
			const payout = await createCase(app.id, { name: "Payout", flows: STEPS });
			// Oldest first, as they ran.
			const ids: string[] = [];
			for (const item of seeded) ids.push(await seedRun(app.id, payout.id, item));
			return { app, payout, ids };
		}

		async function history(caseId: string) {
			const response = await createRunsRoutes().request(`/cases/${caseId}/history`);
			return {
				status: response.status,
				body: (await response.json()) as CaseHistory & { error?: string },
			};
		}

		test("gives the pass rate, the average passing time, the failing count and each Run's duration and step results, newest first", async () => {
			const { payout, ids } = await caseWithRuns("History stats", [
				{ status: "passed", daysAgo: 21, seconds: 34 },
				{ status: "passed", daysAgo: 14, seconds: 30 },
				{ status: "cancelled", daysAgo: 10, seconds: 5, endedAt: 1 },
				{ status: "errored", daysAgo: 6, seconds: 17, endedAt: 2 },
				{ status: "passed", daysAgo: 4, seconds: 32 },
				{ status: "errored", daysAgo: 2, seconds: 9, endedAt: 0, executionMode: "script" },
			]);

			const { status, body } = await history(payout.id);

			expect(status).toBe(200);
			expect(body).toMatchObject({
				caseId: payout.id,
				passed: 3,
				failed: 2,
				averagePassMs: 32_000,
			});
			expect(body.runs.map((run) => run.runId)).toEqual([...ids].reverse());
			expect(body.runs.map((run) => [run.number, run.status, run.durationMs])).toEqual([
				[6, "errored", 9_000],
				[5, "passed", 32_000],
				[4, "errored", 17_000],
				[3, "cancelled", 5_000],
				[2, "passed", 30_000],
				[1, "passed", 34_000],
			]);
			expect(body.runs.map((run) => [run.failedStep, run.steps])).toEqual([
				// A replayed Case Script does not say which step it stopped at.
				[null, ["skipped", "skipped", "skipped"]],
				[null, ["passed", "passed", "passed"]],
				[3, ["passed", "passed", "failed"]],
				[null, ["passed", "skipped", "skipped"]],
				[null, ["passed", "passed", "passed"]],
				[null, ["passed", "passed", "passed"]],
			]);
			// The five that ended mix passes and failures, the stopped one aside.
			expect(body.note).toEqual({ kind: "flaky", passed: 3, failed: 2 });
		});

		test("a case never run has an empty History, and an unknown case is not found", async () => {
			const { payout } = await caseWithRuns("No history", []);
			expect((await history(payout.id)).body).toEqual({
				caseId: payout.id,
				passed: 0,
				failed: 0,
				averagePassMs: null,
				runs: [],
				note: null,
			});
			expect((await history("case_missing")).status).toBe(404);
		});

		test("the note is consistent when the last two or more Runs failed at the same step, from the first of them, a stopped Run between them aside", async () => {
			const { payout, ids } = await caseWithRuns("Consistent", [
				{ status: "passed", daysAgo: 9 },
				{ status: "errored", daysAgo: 8, endedAt: 1 },
				{ status: "errored", daysAgo: 6, endedAt: 2 },
				{ status: "cancelled", daysAgo: 5, endedAt: 0 },
				{ status: "errored", daysAgo: 4, endedAt: 2 },
				{ status: "errored", daysAgo: 1, endedAt: 2 },
			]);
			const createdAt = (await getRun(ids[2] as string)).createdAt;

			expect((await history(payout.id)).body.note).toEqual({
				kind: "consistent",
				step: 3,
				failures: 3,
				since: createdAt,
			});
		});

		test("no note when only the last Run failed, or the last two failed at different steps", async () => {
			const once = await caseWithRuns("Failed once", [
				{ status: "passed", daysAgo: 2 },
				{ status: "errored", daysAgo: 1, endedAt: 2 },
			]);
			expect((await history(once.payout.id)).body.note).toBeNull();
			const apart = await caseWithRuns("Failed apart", [
				{ status: "errored", daysAgo: 2, endedAt: 1 },
				{ status: "errored", daysAgo: 1, endedAt: 2 },
			]);
			expect((await history(apart.payout.id)).body.note).toBeNull();
		});

		test("no consistent note from Runs that failed before their first step, or at a step of the same number with other text", async () => {
			const unstarted = await caseWithRuns("Never started", [
				{ status: "errored", daysAgo: 2, noSteps: true },
				{ status: "errored", daysAgo: 1, noSteps: true },
			]);
			const { body } = await history(unstarted.payout.id);
			expect(body.note).toBeNull();
			expect(body.runs.map((run) => [run.failedStep, run.steps])).toEqual([
				[null, ["skipped", "skipped", "skipped"]],
				[null, ["skipped", "skipped", "skipped"]],
			]);
			const reworded = await caseWithRuns("Step 3 reworded", [
				{
					status: "errored",
					daysAgo: 2,
					endedAt: 2,
					steps: [...STEPS.slice(0, 2), { instructions: "Tap Send", expectedResult: "" }],
				},
				{ status: "errored", daysAgo: 1, endedAt: 2 },
			]);
			expect((await history(reworded.payout.id)).body.note).toBeNull();
		});

		test("the note is flaky when the last five Runs mix passes and failures and ran the same steps", async () => {
			const flaky = await caseWithRuns("Flaky", [
				{ status: "errored", daysAgo: 9, endedAt: 0 },
				{ status: "passed", daysAgo: 5 },
				{ status: "errored", daysAgo: 4, endedAt: 1 },
				{ status: "passed", daysAgo: 3 },
				{ status: "passed", daysAgo: 2 },
				{ status: "errored", daysAgo: 1, endedAt: 2 },
			]);
			expect((await history(flaky.payout.id)).body.note).toEqual({
				kind: "flaky",
				passed: 3,
				failed: 2,
			});
		});

		test("the agent reads the History summary as text, in every mode", async () => {
			const { app, payout } = await caseWithRuns("History for the agent", [
				{ status: "passed", daysAgo: 3, seconds: 30 },
				{ status: "errored", daysAgo: 2, seconds: 12, endedAt: 2 },
				{ status: "errored", daysAgo: 1, seconds: 14, endedAt: 2 },
			]);
			const outputs: Array<{ text: string; isError: boolean }> = [];
			agent.script = async function* (turn) {
				outputs.push(await turn.callTool("get_history", {}));
				yield { type: "text", delta: "It keeps failing at step 3." };
			};
			const chat = await newChat(app.id, payout.id);
			const stream = await openEvents(chat.id);

			for (const [index, mode] of ["ask", "run"].entries()) {
				await send(chat.id, "How healthy is it?", mode);
				await stream.until(() => stream.events.filter(isReply).length === index + 1);
			}
			await stream.close();

			expect(outputs).toHaveLength(2);
			const [output] = outputs as [{ text: string; isError: boolean }];
			expect(output.isError).toBe(false);
			expect(output.text).toContain("History of #1 Payout, over its last 3 Runs");
			expect(output.text).toContain("Passed 1 of the 3 that ended · average passing time 30 s");
			expect(output.text).toContain(
				"Note: consistent failure: the last 2 Runs failed at step 3, the first of them at",
			);
			expect(output.text).toContain("Run 3 · failed at step 3 · 14 s");
			expect(output.text).toContain("steps: passed, passed, failed");
			expect(output.text).toContain("Run 1 · passed · 30 s");
		});

		test("no flaky note when the steps changed between those five Runs, when they all passed, or with fewer than five", async () => {
			const changed = await caseWithRuns("Steps changed", [
				{ status: "passed", daysAgo: 5, steps: STEPS.slice(0, 2) },
				{ status: "errored", daysAgo: 4, endedAt: 1 },
				{ status: "passed", daysAgo: 3 },
				{ status: "errored", daysAgo: 2, endedAt: 0 },
				{ status: "passed", daysAgo: 1 },
			]);
			expect((await history(changed.payout.id)).body.note).toBeNull();
			// A Run from before Runs kept their steps cannot say they were the same.
			const unknown = await caseWithRuns("Steps unknown", [
				{ status: "passed", daysAgo: 5, steps: null },
				{ status: "errored", daysAgo: 4, endedAt: 1 },
				{ status: "passed", daysAgo: 3 },
				{ status: "errored", daysAgo: 2, endedAt: 0 },
				{ status: "passed", daysAgo: 1 },
			]);
			expect((await history(unknown.payout.id)).body.note).toBeNull();
			const passing = await caseWithRuns("All pass", [
				{ status: "passed", daysAgo: 5 },
				{ status: "passed", daysAgo: 4 },
				{ status: "passed", daysAgo: 3 },
				{ status: "passed", daysAgo: 2 },
				{ status: "passed", daysAgo: 1 },
			]);
			expect((await history(passing.payout.id)).body.note).toBeNull();
			const few = await caseWithRuns("Few runs", [
				{ status: "passed", daysAgo: 3 },
				{ status: "errored", daysAgo: 2, endedAt: 1 },
				{ status: "passed", daysAgo: 1 },
			]);
			expect((await history(few.payout.id)).body.note).toBeNull();
		});
	});
});
