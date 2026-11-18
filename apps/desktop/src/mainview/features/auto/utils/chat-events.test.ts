import { describe, expect, test } from "bun:test";
import {
	applyAutoChatEvent,
	parseAutoChatEvent,
	summaryOf,
} from "@/features/auto/utils/chat-events";
import type { AutoChat, AutoChatEvent, AutoMessage, AutoRun, CaseDraft } from "@yoqa/runner-client";

function chat(overrides: Partial<AutoChat> = {}): AutoChat {
	return {
		id: "chat_1",
		appId: "app_1",
		caseId: null,
		caseNumber: null,
		caseName: null,
		title: "",
		model: null,
		createdAt: 100,
		updatedAt: 100,
		messages: [],
		reply: null,
		draft: null,
		run: null,
		...overrides,
	};
}

function run(overrides: Partial<AutoRun> = {}): AutoRun {
	return {
		runId: "run_1",
		caseId: "case_1",
		status: "running",
		executionMode: "agent",
		provider: "OpenAI · gpt-5",
		createdAt: 100,
		startedAt: 110,
		finishedAt: null,
		currentStep: 1,
		currentCommand: null,
		steps: [{ instructions: "Tap Pay", expectedResult: "", status: "running", commands: [] }],
		replayed: [],
		error: null,
		...overrides,
	};
}

function message(overrides: Partial<AutoMessage> = {}): AutoMessage {
	return {
		id: "msg_1",
		chatId: "chat_1",
		role: "user",
		mode: "ask",
		text: "Why did the last run fail?",
		toolCalls: [],
		error: null,
		createdAt: 200,
		...overrides,
	};
}

function applyAll(start: AutoChat, events: AutoChatEvent[]): AutoChat {
	return events.reduce(applyAutoChatEvent, start);
}

describe("parseAutoChatEvent", () => {
	test("reads one event from a data line", () => {
		expect(parseAutoChatEvent(JSON.stringify({ type: "text", delta: "Hi" }))).toEqual({
			type: "text",
			delta: "Hi",
		});
	});

	test("ignores lines that are not JSON or not an Auto chat event", () => {
		expect(parseAutoChatEvent("not json")).toBeNull();
		expect(parseAutoChatEvent(JSON.stringify({ type: "ping" }))).toBeNull();
	});
});

describe("applyAutoChatEvent", () => {
	test("the user's prompt is saved and a reply starts being written", () => {
		const next = applyAutoChatEvent(chat(), { type: "message", message: message() });
		expect(next.messages.map((row) => row.id)).toEqual(["msg_1"]);
		expect(next.reply).toEqual({ text: "", toolCalls: [] });
		expect(next.updatedAt).toBe(200);
	});

	test("text deltas append to the in-flight reply", () => {
		const next = applyAll(chat(), [
			{ type: "message", message: message() },
			{ type: "text", delta: "The last run " },
			{ type: "text", delta: "failed at step 3." },
		]);
		expect(next.reply?.text).toBe("The last run failed at step 3.");
	});

	test("a tool call shows running, then its result", () => {
		const call = { id: "tool_1", name: "list_runs", input: { caseId: "case_8" } };
		const running = applyAll(chat(), [
			{ type: "message", message: message() },
			{ type: "tool_call", call },
		]);
		expect(running.reply?.toolCalls).toEqual([{ ...call, output: null, isError: false }]);

		const done = applyAutoChatEvent(running, {
			type: "tool_result",
			id: "tool_1",
			output: "2 runs",
			isError: false,
		});
		expect(done.reply?.toolCalls[0]).toMatchObject({ output: "2 runs", isError: false });
	});

	test("the same tool call twice shows once, and a result for an unknown call changes nothing", () => {
		const call = { id: "tool_1", name: "list_runs", input: {} };
		const once = applyAll(chat(), [
			{ type: "tool_call", call },
			{ type: "tool_call", call },
		]);
		expect(once.reply?.toolCalls).toHaveLength(1);
		const unknown = applyAutoChatEvent(once, {
			type: "tool_result",
			id: "tool_2",
			output: "x",
			isError: true,
		});
		expect(unknown).toBe(once);
	});

	test("the saved reply replaces the in-flight one", () => {
		const reply = message({
			id: "msg_2",
			role: "assistant",
			mode: null,
			text: "It failed at step 3.",
			createdAt: 300,
		});
		const next = applyAll(chat(), [
			{ type: "message", message: message() },
			{ type: "text", delta: "It failed" },
			{ type: "message", message: reply },
		]);
		expect(next.messages.map((row) => row.id)).toEqual(["msg_1", "msg_2"]);
		expect(next.reply).toBeNull();
		expect(next.updatedAt).toBe(300);
	});

	test("the prompt arriving twice (stream and POST) shows once and keeps the reply", () => {
		const next = applyAll(chat(), [
			{ type: "message", message: message() },
			{ type: "text", delta: "Looking" },
			{ type: "message", message: message() },
		]);
		expect(next.messages).toHaveLength(1);
		expect(next.reply?.text).toBe("Looking");
	});

	test("a message of another chat is ignored", () => {
		const start = chat();
		expect(
			applyAutoChatEvent(start, { type: "message", message: message({ chatId: "chat_2" }) }),
		).toBe(start);
	});

	test("a chat event updates the header fields and keeps the messages", () => {
		const start = chat({ messages: [message()] });
		const next = applyAutoChatEvent(start, {
			type: "chat",
			chat: {
				...summaryOf(start),
				caseId: "case_8",
				caseNumber: 8,
				caseName: "Payout",
				title: "Payout failure",
			},
		});
		expect(next).toMatchObject({ caseNumber: 8, caseName: "Payout", title: "Payout failure" });
		expect(next.messages).toHaveLength(1);
	});

	test("a draft event replaces the chat's Case draft, and a null one clears it", () => {
		const draft: CaseDraft = {
			caseId: "case_1",
			base: [],
			steps: [
				{ id: "s1", instructions: "Open", expectedResult: "", flowId: null, reason: "First step" },
			],
			removed: [],
			passingRunId: null,
			learnedScript: null,
			updatedAt: 300,
		};
		const drafted = applyAutoChatEvent(chat(), { type: "draft", draft });
		expect(drafted.draft).toEqual(draft);
		expect(applyAutoChatEvent(drafted, { type: "draft", draft: null }).draft).toBeNull();
	});

	test("does not change the chat it is given", () => {
		const start = chat();
		applyAutoChatEvent(start, { type: "message", message: message() });
		expect(start.messages).toEqual([]);
		expect(start.reply).toBeNull();
	});
});

describe("summaryOf", () => {
	test("drops the messages, the reply and the Case draft", () => {
		const summary = summaryOf(chat({ messages: [message()], reply: { text: "", toolCalls: [] } }));
		expect("messages" in summary).toBe(false);
		expect("reply" in summary).toBe(false);
		expect("draft" in summary).toBe(false);
		expect(summary.id).toBe("chat_1");
	});

	test("a run event shows the chat's Run card, and the next prompt clears a Run that ended", () => {
		const live = applyAutoChatEvent(chat(), { type: "run", run: run() });
		expect(live.run).toEqual(run());
		const ended = applyAutoChatEvent(live, {
			type: "run",
			run: run({ status: "passed", finishedAt: 200, currentStep: null }),
		});
		expect(ended.run?.status).toBe("passed");
		const reply = applyAutoChatEvent(ended, {
			type: "message",
			message: message({ id: "msg_reply", role: "assistant", mode: null }),
		});
		expect(reply.run?.status).toBe("passed");
		const next = applyAutoChatEvent(reply, {
			type: "message",
			message: message({ id: "msg_next", text: "Again" }),
		});
		expect(next.run).toBeNull();
		const stillLive = applyAutoChatEvent(live, {
			type: "message",
			message: message({ id: "msg_queued", text: "Meanwhile" }),
		});
		expect(stillLive.run).toEqual(run());
	});
});
