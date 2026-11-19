import { describe, expect, test } from "bun:test";
import {
	chatAgentLabel,
	chatCaseLabel,
	chatProviderProblem,
	chatTitle,
	pickFromKey,
	pickerSections,
	toolCallInputText,
	toolCallName,
	toolCallState,
} from "@/features/auto/utils/chat-labels";
import type { AutoChatProvider } from "@yoqa/runner-client";

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

const CLAUDE: AutoChatProvider = {
	id: "prov_claude",
	kind: "claude",
	label: "Claude",
	available: true,
	reason: null,
	models: MODELS,
	defaultModel: "sonnet",
};
const CODEX: AutoChatProvider = {
	id: "prov_codex",
	kind: "codex",
	label: "Codex",
	available: false,
	reason: "Codex's CLI login cannot run the Auto chat yet; add an OpenAI API key to Codex.",
	models: [],
	defaultModel: "gpt-4o",
};
const OPENAI: AutoChatProvider = {
	id: "prov_openai",
	kind: "openai",
	label: "OpenAI",
	available: true,
	reason: null,
	models: [{ id: "gpt-4o", name: "gpt-4o" }],
	defaultModel: "gpt-4o",
};

describe("the Provider-and-model picker", () => {
	test("groups each Provider's models under it, Default first, naming the model it stands for", () => {
		const sections = pickerSections([CLAUDE, OPENAI], { providerId: "prov_claude", model: null });
		expect(
			sections.map((section) => [section.label, section.options.map((option) => option.label)]),
		).toEqual([
			["Claude", ["Default (Sonnet)", "Opus", "Sonnet"]],
			["OpenAI", ["Default (gpt-4o)", "gpt-4o"]],
		]);
		expect(pickFromKey(sections[1]?.options[1]?.key ?? "")).toEqual({
			providerId: "prov_openai",
			model: "gpt-4o",
		});
		expect(pickFromKey(sections[0]?.options[0]?.key ?? "")).toEqual({
			providerId: "prov_claude",
			model: null,
		});
	});

	test("a Provider that cannot chat has no models, and keeps its reason", () => {
		const [codex] = pickerSections([CODEX], { providerId: null, model: null });
		expect(codex).toMatchObject({ available: false, reason: CODEX.reason, options: [] });
	});

	test("keeps a chat model the list no longer has, under the chat's Provider", () => {
		const [claude] = pickerSections([CLAUDE], { providerId: "prov_claude", model: "claude-old" });
		expect(claude?.options.at(-1)).toMatchObject({ label: "claude-old", model: "claude-old" });
	});

	test("names who answers the chat, and asks for a Provider when it has none that can", () => {
		expect(chatAgentLabel([CLAUDE], { providerId: "prov_claude", model: "opus" })).toBe(
			"Claude · Opus",
		);
		expect(chatAgentLabel([CLAUDE], { providerId: "prov_claude", model: null })).toBe(
			"Claude · Default",
		);
		expect(chatProviderProblem([CLAUDE], { providerId: "prov_claude" })).toBeNull();
		expect(chatProviderProblem([CLAUDE], { providerId: null })).toBe(
			"This chat has no Provider. Pick one in the picker below.",
		);
		expect(chatProviderProblem([CLAUDE], { providerId: "prov_gone" })).toBe(
			"The Provider this chat was on was removed or disabled. Pick another in the picker below.",
		);
		expect(chatProviderProblem([CODEX], { providerId: "prov_codex" })).toBe(
			`Codex cannot answer this chat: ${CODEX.reason} Pick another in the picker below.`,
		);
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
