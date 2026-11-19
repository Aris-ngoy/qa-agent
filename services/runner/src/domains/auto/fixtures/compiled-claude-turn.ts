/**
 * One Claude Auto turn, compiled with `bun build --compile` by `claude-agent-compiled.test.ts`,
 * the way the desktop app compiles the runner. `YOQA_TEST_CLAUDE_BIN` is the Provider's Claude
 * CLI. Writes `ok` to `YOQA_TEST_TURN_RESULT` when the turn ends, or the error that stopped it.
 */
import { writeFileSync } from "node:fs";
import type { ActiveProviderAuth } from "../../providers/application";
import type { ChatTurn } from "../chat-agent";
import { createClaudeChatAgent } from "../claude-agent";

const turn: ChatTurn = {
	chatId: "compiled",
	prompt: "Hi",
	mode: "ask",
	providerId: "prov_claude",
	model: null,
	agentSessionId: null,
	agentHistory: null,
	conversation: null,
	systemPrompt: "You are the Yoqa Auto chat.",
	tools: [],
	callTool: async () => ({ text: "", isError: false }),
	signal: new AbortController().signal,
};

const auth: ActiveProviderAuth = {
	id: "prov_claude",
	kind: "claude",
	authMode: "api_key",
	apiKey: "sk-ant-test",
	baseUrl: null,
	serverUrl: null,
	defaultModel: null,
	binaryPath: process.env.YOQA_TEST_CLAUDE_BIN ?? null,
	env: {},
};

let result = "ok";
try {
	for await (const _event of createClaudeChatAgent().runTurn(turn, auth)) {
	}
} catch (error) {
	result = error instanceof Error ? error.message : String(error);
}
writeFileSync(process.env.YOQA_TEST_TURN_RESULT ?? "turn-result.txt", result);
