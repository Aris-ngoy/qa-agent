import { afterEach, describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { listDrivers } from ".";
import { githubCopilotDriver } from "./github-copilot";
import { groqDriver } from "./groq";
import type { VisionAuth } from "./types";

/**
 * Chat model factories, only where they resolve credentials or endpoints differently from the
 * Provider's vision port.
 */

function auth(kind: VisionAuth["kind"], apiKey: string): VisionAuth {
	return {
		kind,
		authMode: kind === "github-copilot" ? "token" : "api_key",
		apiKey,
		baseUrl: null,
		serverUrl: null,
		defaultModel: null,
		binaryPath: null,
		env: {},
	};
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("chat model factories", () => {
	test("every Provider that chats beyond the Claude Agent SDK has a chat model factory", () => {
		for (const driver of listDrivers()) {
			const servedByAiSdk =
				driver.kind !== "claude" && driver.capabilities.chat.some((mode) => mode !== "cli");
			expect({ kind: driver.kind, factory: Boolean(driver.chat) }).toEqual({
				kind: driver.kind,
				factory: servedByAiSdk,
			});
		}
	});

	test("Groq chats on a text-only model, which its vision port refuses", async () => {
		const model = await groqDriver.chat?.createModel(
			auth("groq", "gsk_test"),
			"openai/gpt-oss-20b",
		);
		expect(model).toBeDefined();
	});

	test("GitHub Copilot exchanges the GitHub token, then chats on the Copilot API with that token", async () => {
		const requests: Array<{ url: string; headers: Headers }> = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			requests.push({ url, headers: new Headers(init?.headers) });
			if (url.endsWith("/copilot_internal/v2/token")) return Response.json({ token: "cop_short" });
			return Response.json({
				id: "chatcmpl-1",
				object: "chat.completion",
				created: 0,
				model: "gpt-4o",
				choices: [
					{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" },
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
		}) as typeof fetch;

		const model = await githubCopilotDriver.chat?.createModel(
			auth("github-copilot", "ghu_github"),
			"gpt-4o",
		);
		if (!model) throw new Error("no Copilot chat model");
		await generateText({ model, prompt: "Hello" });

		expect(requests[0]?.headers.get("authorization")).toBe("token ghu_github");
		expect(requests[1]?.url).toBe("https://api.githubcopilot.com/chat/completions");
		expect(requests[1]?.headers.get("authorization")).toBe("Bearer cop_short");
		expect(requests[1]?.headers.get("copilot-integration-id")).toBe("vscode-chat");
	});
});
