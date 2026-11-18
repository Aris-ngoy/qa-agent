import { describe, expect, test } from "bun:test";
import {
	DEFAULT_MODEL_KEY,
	chatCaseLabel,
	chatTitle,
	modelFromKey,
	modelKey,
	modelOptions,
	toolCallInputText,
	toolCallName,
	toolCallState,
} from "@/features/auto/utils/chat-labels";

const MODELS = [
	{ id: "opus", name: "Opus" },
	{ id: "sonnet", name: "Sonnet" },
];

describe("chatTitle", () => {
	test("is the chat's title, or New chat before it has one", () => {
		expect(chatTitle({ title: "Payout failure" })).toBe("Payout failure");
		expect(chatTitle({ title: "  " })).toBe("New chat");
	});
});

describe("chatCaseLabel", () => {
	test("names the Test Case by number and name", () => {
		expect(chatCaseLabel({ caseId: "case_8", caseNumber: 8, caseName: "Payout" })).toBe(
			"#8 Payout",
		);
	});

	test("is null without a Test Case", () => {
		expect(chatCaseLabel({ caseId: null, caseNumber: null, caseName: null })).toBeNull();
	});

	test("falls back to the number alone", () => {
		expect(chatCaseLabel({ caseId: "case_8", caseNumber: 8, caseName: null })).toBe("#8");
	});
});

describe("modelOptions", () => {
	test("lists Default first, then the Provider's models", () => {
		expect(modelOptions(MODELS, null, null)).toEqual([
			{ id: DEFAULT_MODEL_KEY, label: "Default" },
			{ id: "opus", label: "Opus" },
			{ id: "sonnet", label: "Sonnet" },
		]);
	});

	test("names the model Default stands for", () => {
		expect(modelOptions(MODELS, "sonnet", null)[0]?.label).toBe("Default (Sonnet)");
	});

	test("keeps a chat model the list no longer has", () => {
		expect(modelOptions(MODELS, null, "claude-old").at(-1)).toEqual({
			id: "claude-old",
			label: "claude-old",
		});
	});

	test("maps a chat model to a picker key and back", () => {
		expect(modelKey(null)).toBe(DEFAULT_MODEL_KEY);
		expect(modelFromKey(modelKey(null))).toBeNull();
		expect(modelFromKey(modelKey("opus"))).toBe("opus");
	});
});

describe("tool calls", () => {
	test("reads a tool's name as words, with or without the MCP prefix", () => {
		expect(toolCallName("list_runs")).toBe("list runs");
		expect(toolCallName("mcp__yoqa__get_test_case")).toBe("get test case");
	});

	test("is running until it has output, then done or failed", () => {
		expect(toolCallState({ output: null, isError: false })).toBe("running");
		expect(toolCallState({ output: "ok", isError: false })).toBe("done");
		expect(toolCallState({ output: "nope", isError: true })).toBe("failed");
	});

	test("shows the input on one line, and nothing when there is none", () => {
		expect(toolCallInputText({ runId: "run_1" })).toBe('{"runId":"run_1"}');
		expect(toolCallInputText({})).toBe("");
		expect(toolCallInputText(undefined)).toBe("");
	});
});
