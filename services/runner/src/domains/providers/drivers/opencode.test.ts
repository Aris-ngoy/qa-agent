import { describe, expect, test } from "bun:test";
import {
	formatProviderHttpError,
	looksLikeHtmlResponse,
	repairModelJsonText,
	withOpenCodeRequestHooks,
} from "../vision-model";
import {
	groupOpenCodeModelsByProvider,
	humanizeOpenCodeProvider,
	isOpenCodeZenModel,
	listOpenCodeModelsFromCli,
	openCodeServerAuthHeaders,
	parseOpenCodeModelSlug,
	stripOpenCodeModelSlug,
	toOpenCodeModelEntry,
} from "./opencode";

describe("parseOpenCodeModelSlug", () => {
	test("splits provider/model slugs", () => {
		expect(parseOpenCodeModelSlug("amazon-bedrock/amazon.nova-lite-v1:0")).toEqual({
			providerId: "amazon-bedrock",
			modelId: "amazon.nova-lite-v1:0",
		});
		expect(parseOpenCodeModelSlug("litellm/claude-haiku-4-5")).toEqual({
			providerId: "litellm",
			modelId: "claude-haiku-4-5",
		});
	});

	test("treats bare ids as OpenCode Zen", () => {
		expect(parseOpenCodeModelSlug("big-pickle")).toEqual({
			providerId: "opencode",
			modelId: "big-pickle",
		});
		expect(isOpenCodeZenModel("big-pickle")).toBe(true);
		expect(isOpenCodeZenModel("opencode/claude-haiku-4-5")).toBe(true);
		expect(isOpenCodeZenModel("litellm/claude-haiku-4-5")).toBe(false);
	});
});

describe("stripOpenCodeModelSlug", () => {
	test("strips provider prefix", () => {
		expect(stripOpenCodeModelSlug("opencode/deepseek-v4-flash-free")).toBe(
			"deepseek-v4-flash-free",
		);
	});

	test("leaves bare ids alone", () => {
		expect(stripOpenCodeModelSlug("big-pickle")).toBe("big-pickle");
	});
});

describe("toOpenCodeModelEntry", () => {
	test("keeps CLI slugs and labels OpenCode providers", () => {
		expect(humanizeOpenCodeProvider("amazon-bedrock")).toBe("Amazon Bedrock");
		expect(humanizeOpenCodeProvider("opencode")).toBe("OpenCode Zen");
		expect(toOpenCodeModelEntry("amazon-bedrock/amazon.nova-lite-v1:0")).toEqual({
			id: "amazon-bedrock/amazon.nova-lite-v1:0",
			name: "Amazon.nova Lite V1:0",
			provider: "Amazon Bedrock",
		});
		expect(toOpenCodeModelEntry("opencode/mimo-v2.5-free")).toMatchObject({
			id: "opencode/mimo-v2.5-free",
			name: "Mimo V2.5 Free",
			provider: "OpenCode Zen",
		});
		expect(toOpenCodeModelEntry("litellm/claude-haiku-4-5")).toEqual({
			id: "litellm/claude-haiku-4-5",
			name: "Claude Haiku 4 5",
			provider: "LiteLLM",
		});
	});
});

describe("groupOpenCodeModelsByProvider", () => {
	test("pins OpenCode Zen first then sorts remaining providers", () => {
		const groups = groupOpenCodeModelsByProvider([
			toOpenCodeModelEntry("github-copilot/gpt-4.1"),
			toOpenCodeModelEntry("amazon-bedrock/amazon.nova-lite-v1:0"),
			toOpenCodeModelEntry("litellm/claude-haiku-4-5"),
			toOpenCodeModelEntry("opencode/mimo-v2.5-free"),
		]);
		expect(groups.map((group) => group.provider)).toEqual([
			"OpenCode Zen",
			"Amazon Bedrock",
			"GitHub Copilot",
			"LiteLLM",
		]);
	});
});

describe("openCodeServerAuthHeaders", () => {
	test("uses Basic opencode:password like t3code", () => {
		const headers = openCodeServerAuthHeaders("secret");
		expect(headers.Authorization).toBe(
			`Basic ${Buffer.from("opencode:secret").toString("base64")}`,
		);
	});

	test("omits header when password empty", () => {
		expect(openCodeServerAuthHeaders("")).toEqual({});
		expect(openCodeServerAuthHeaders(null)).toEqual({});
	});
});

describe("listOpenCodeModelsFromCli", () => {
	test("lists models when opencode is installed", async () => {
		const result = await listOpenCodeModelsFromCli(null);
		if (result.models.length === 0) {
			// Environment without CLI — skip asserting catalog size.
			expect(result.detail.length).toBeGreaterThan(0);
			return;
		}
		expect(
			result.models.some(
				(m) => m.id === "opencode/deepseek-v4-flash-free" || m.id === "deepseek-v4-flash-free",
			),
		).toBe(true);
		expect(result.models.every((m) => Boolean(m.provider))).toBe(true);
	});
});

describe("OpenCode HTML error formatting", () => {
	test("detects SPA HTML bodies", () => {
		expect(
			looksLikeHtmlResponse(
				'<!doctype html> <html lang="en" style="background-color: var(--v2-background-bg-deep, #fafafa)">',
			),
		).toBe(true);
	});

	test("maps HTML 200 to Zen key guidance", () => {
		const message = formatProviderHttpError(
			"OpenCode",
			200,
			'<!doctype html> <html lang="en"><title>OpenCode</title>',
		);
		expect(message).toContain("Zen API key");
		expect(message).not.toContain("<!doctype");
	});

	test("maps text-only image_url 400 to vision model guidance", () => {
		const message = formatProviderHttpError(
			"OpenCode",
			400,
			'{"error":{"message":"unknown variant `image_url`, expected `text`"}}',
		);
		expect(message).toContain("mimo-v2.5-free");
		expect(message).toContain("text-only");
	});

	test("maps Bedrock output_config.format 400 to LiteLLM JSON-mode guidance", () => {
		const message = formatProviderHttpError(
			"OpenCode",
			400,
			'{"error":{"message":"litellm.BadRequestError: BedrockException - {\\"message\\":\\"output_config.format: Extra inputs are not permitted\\"}"}}',
		);
		expect(message).toContain("output_config.format");
		expect(message).toContain("LiteLLM");
	});
});

describe("repairModelJsonText", () => {
	test("unwraps markdown-fenced JSON objects", () => {
		expect(
			JSON.parse(
				repairModelJsonText(
					'```json\n{ "type": "wait", "ms": 2000, "reason": "loading", "thoughts": "splash" }\n```',
				),
			),
		).toEqual({
			type: "wait",
			ms: 2000,
			reason: "loading",
			thoughts: "splash",
		});
	});
});

describe("withOpenCodeRequestHooks", () => {
	test("strips response_format for LiteLLM/Bedrock gateways", async () => {
		let sentBody = "";
		const fetchImpl = (async (_input, init) => {
			sentBody = String(init?.body ?? "");
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const hooked = withOpenCodeRequestHooks({
			disableThinking: false,
			stripResponseFormat: true,
			authHeaders: null,
			fetchImpl,
		});
		await hooked("https://example.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "claude-sonnet-5",
				response_format: { type: "json_schema", json_schema: { name: "response" } },
			}),
		});
		const parsed = JSON.parse(sentBody) as { model: string; response_format?: unknown };
		expect(parsed.model).toBe("claude-sonnet-5");
		expect(parsed.response_format).toBeUndefined();
	});
});
