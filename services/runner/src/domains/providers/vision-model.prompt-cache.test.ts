import { describe, expect, test } from "bun:test";
import type { CallUsage } from "@yoqa/runner-client";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { VisionAuth, VisionPrompt } from "./drivers/types";
import { createSdkVisionPort } from "./vision-model";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type CallOptions = MockLanguageModelV4["doGenerateCalls"][number];

const AUTH: VisionAuth = {
	kind: "anthropic",
	authMode: "api_key",
	apiKey: "test-key",
	baseUrl: null,
	serverUrl: null,
	defaultModel: null,
	binaryPath: null,
	env: {},
};

const IMAGE = { base64: "aW1hZ2U=", mediaType: "image/png" as const };
const SCHEMA = z.object({ type: z.string(), reason: z.string() });
const VALID_REPLY = '{"type":"tap","reason":"Open settings"}';

const TEST_CASE_BLOCK = "App context: Rewards app\nTest case: Open settings";

function step(text: string): VisionPrompt {
	return { testCase: TEST_CASE_BLOCK, step: text };
}

function reply(text: string, extra: Partial<GenerateResult> = {}): GenerateResult {
	return {
		content: [{ type: "text", text }],
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
			outputTokens: { total: 5, text: 5, reasoning: undefined },
		},
		warnings: [],
		...extra,
	};
}

function mockModel(provider: string, replies: GenerateResult[]) {
	return new MockLanguageModelV4({ provider, modelId: "mock-model", doGenerate: replies });
}

function portFor(model: MockLanguageModelV4) {
	return createSdkVisionPort({
		label: "Mock",
		defaultModel: "mock-model",
		createModel: () => model,
	});
}

function userContent(call: CallOptions | undefined) {
	if (!call) throw new Error("no model call");
	const user = call.prompt.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("no user message");
	return user.content;
}

function systemMessage(call: CallOptions | undefined) {
	if (!call) throw new Error("no model call");
	const system = call.prompt.find((message) => message.role === "system");
	if (!system || system.role !== "system") throw new Error("no system message");
	return system;
}

function textOf(part: ReturnType<typeof userContent>[number] | undefined): string {
	if (!part) throw new Error("missing part");
	if (part.type !== "text") throw new Error(`expected text part, got ${part.type}`);
	return part.text;
}

describe("shared SDK vision port: Prompt cache order", () => {
	test("sends the Test Case block, then the screenshot, then the step block", async () => {
		const model = mockModel("openai.chat", [reply(VALID_REPLY)]);
		await portFor(model).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You are a QA agent.",
			prompt: step("Current instruction (do ONLY this): Tap the gear"),
			imageBase64: IMAGE.base64,
			image: IMAGE,
		});

		const content = userContent(model.doGenerateCalls[0]);
		expect(content.map((part) => part.type)).toEqual(["text", "file", "text"]);
		expect(textOf(content[0])).toBe(TEST_CASE_BLOCK);
		expect(textOf(content[2])).toBe("Current instruction (do ONLY this): Tap the gear");
	});

	test("a prompt without a Test Case sends only the screenshot and the step block", async () => {
		const model = mockModel("anthropic.messages", [reply(VALID_REPLY)]);
		await portFor(model).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You locate UI elements on a mobile screen.",
			prompt: { step: "Find: Allow button" },
			imageBase64: IMAGE.base64,
			image: IMAGE,
		});

		const content = userContent(model.doGenerateCalls[0]);
		expect(content.map((part) => part.type)).toEqual(["file", "text"]);
		expect(textOf(content[1])).toBe("Find: Allow button");
	});

	test("two steps of the same Test Case share the prefix up to the screenshot", async () => {
		const model = mockModel("openai.chat", [reply(VALID_REPLY), reply(VALID_REPLY)]);
		const port = portFor(model);
		for (const text of ["Instruction 1 of 2: Tap the gear", "Instruction 2 of 2: Tap Logout"]) {
			await port.completeObject({
				auth: AUTH,
				schema: SCHEMA,
				system: "You are a QA agent.",
				prompt: step(text),
				imageBase64: IMAGE.base64,
				image: IMAGE,
			});
		}

		const [first, second] = model.doGenerateCalls;
		expect(systemMessage(first)).toEqual(systemMessage(second));
		expect(userContent(first).slice(0, 2)).toEqual(userContent(second).slice(0, 2));
		expect(userContent(first)[2]).not.toEqual(userContent(second)[2]);
	});
});

describe("shared SDK vision port: Anthropic cache breakpoints", () => {
	const anthropicCache = { anthropic: { cacheControl: { type: "ephemeral" } } };

	test("an Anthropic model gets ephemeral markers on the system prompt and the Test Case block", async () => {
		const model = mockModel("anthropic.messages", [reply(VALID_REPLY)]);
		await portFor(model).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You are a QA agent.",
			prompt: step("Tap the gear"),
			imageBase64: IMAGE.base64,
			image: IMAGE,
		});

		const call = model.doGenerateCalls[0];
		expect(systemMessage(call).providerOptions).toEqual(anthropicCache);
		const [testCase, image, stepBlock] = userContent(call);
		expect(testCase?.providerOptions).toEqual(anthropicCache);
		expect(image?.providerOptions).toBeUndefined();
		expect(stepBlock?.providerOptions).toBeUndefined();
	});

	test("a non-Anthropic model gets no cache markers", async () => {
		const model = mockModel("openai.chat", [reply(VALID_REPLY)]);
		await portFor(model).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You are a QA agent.",
			prompt: step("Tap the gear"),
			imageBase64: IMAGE.base64,
			image: IMAGE,
		});

		const call = model.doGenerateCalls[0];
		expect(systemMessage(call).providerOptions).toBeUndefined();
		for (const part of userContent(call)) {
			expect(part.providerOptions).toBeUndefined();
		}
	});
});

describe("shared SDK vision port: JSON-repair retry", () => {
	test("keeps the cached prefix, repairs only the step block, and reports usage per attempt", async () => {
		const model = mockModel("anthropic.messages", [
			reply("I would tap the gear icon."),
			reply(VALID_REPLY),
		]);
		const usages: CallUsage[] = [];
		let retries = 0;
		const result = await portFor(model).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You are a QA agent.",
			prompt: step("Tap the gear"),
			imageBase64: IMAGE.base64,
			image: IMAGE,
			onDecideRetry: () => {
				retries += 1;
			},
			onUsage: (usage) => usages.push(usage),
		});

		expect(result).toEqual({ type: "tap", reason: "Open settings" });
		expect(retries).toBe(1);
		const [first, repair] = model.doGenerateCalls;
		expect(systemMessage(repair)).toEqual(systemMessage(first));
		expect(userContent(repair).slice(0, 2)).toEqual(userContent(first).slice(0, 2));
		expect(textOf(userContent(repair)[2])).toStartWith("Tap the gear\n\n");
		expect(textOf(userContent(repair)[2])).toContain("not valid JSON");
		expect(usages).toEqual([
			{ inputTokens: 10, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 5 },
			{ inputTokens: 10, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 5 },
		]);
	});
});

describe("shared SDK vision port: Call usage", () => {
	async function usageFor(provider: string, result: GenerateResult): Promise<CallUsage[]> {
		const usages: CallUsage[] = [];
		await portFor(mockModel(provider, [result])).completeObject({
			auth: AUTH,
			schema: SCHEMA,
			system: "You are a QA agent.",
			prompt: step("Tap the gear"),
			imageBase64: IMAGE.base64,
			image: IMAGE,
			onUsage: (usage) => usages.push(usage),
		});
		return usages;
	}

	const ANTHROPIC_METADATA = {
		anthropic: {
			usage: {
				input_tokens: 100,
				cache_creation_input_tokens: 200,
				cache_read_input_tokens: 1200,
				output_tokens: 40,
			},
		},
	};

	test("converts Anthropic cache reads and cache writes", async () => {
		const usages = await usageFor(
			"anthropic.messages",
			reply(VALID_REPLY, {
				usage: {
					inputTokens: { total: 1500, noCache: 100, cacheRead: 1200, cacheWrite: 200 },
					outputTokens: { total: 40, text: 40, reasoning: undefined },
				},
				providerMetadata: ANTHROPIC_METADATA,
			}),
		);
		expect(usages).toEqual([
			{ inputTokens: 100, cachedInputTokens: 1200, cacheWriteTokens: 200, outputTokens: 40 },
		]);
	});

	test("falls back to Anthropic provider metadata when usage details are missing", async () => {
		const usages = await usageFor(
			"anthropic.messages",
			reply(VALID_REPLY, {
				usage: {
					inputTokens: {
						total: undefined,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 40, text: undefined, reasoning: undefined },
				},
				providerMetadata: ANTHROPIC_METADATA,
			}),
		);
		expect(usages).toEqual([
			{ inputTokens: 100, cachedInputTokens: 1200, cacheWriteTokens: 200, outputTokens: 40 },
		]);
	});

	test("converts OpenAI cached prompt tokens", async () => {
		const usages = await usageFor(
			"openai.chat",
			reply(VALID_REPLY, {
				usage: {
					inputTokens: { total: 2000, noCache: 500, cacheRead: 1500, cacheWrite: undefined },
					outputTokens: { total: 30, text: 30, reasoning: undefined },
					raw: { prompt_tokens: 2000, prompt_tokens_details: { cached_tokens: 1500 } },
				},
			}),
		);
		expect(usages).toEqual([
			{ inputTokens: 500, cachedInputTokens: 1500, cacheWriteTokens: null, outputTokens: 30 },
		]);
	});

	test("reports unknown counts as null, not zero", async () => {
		const usages = await usageFor(
			"openai.chat",
			reply(VALID_REPLY, {
				usage: {
					inputTokens: {
						total: undefined,
						noCache: undefined,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: undefined, text: undefined, reasoning: undefined },
				},
			}),
		);
		expect(usages).toEqual([
			{ inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null },
		]);
	});
});
