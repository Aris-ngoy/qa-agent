import { describe, expect, test } from "bun:test";
import {
	interpolateOpenCodeTemplate,
	parseOpenCodeCompatibleProvider,
	resolveOpenCodeCompatibleAuth,
} from "./opencode-config";

const liteLlmConfig = {
	provider: {
		litellm: {
			npm: "@ai-sdk/openai-compatible",
			name: "LiteLLM",
			options: {
				baseURL: "https://litellm.example.test/v1",
				apiKey: "{env:YOQA_TEST_LITELLM_API_KEY}",
				headers: {
					"x-litellm-end-user-id": "{env:YOQA_TEST_LITELLM_END_USER_ID}",
				},
			},
			models: {
				"claude-haiku-4-5": { name: "Claude Haiku 4.5" },
			},
		},
		"amazon-bedrock": {
			npm: "@ai-sdk/amazon-bedrock",
		},
	},
};

describe("interpolateOpenCodeTemplate", () => {
	test("expands {env:VAR} from the env bag", () => {
		expect(
			interpolateOpenCodeTemplate("prefix-{env:YOQA_OPENCODE_TEST_VAR}-suffix", {
				YOQA_OPENCODE_TEST_VAR: "abc",
			}),
		).toBe("prefix-abc-suffix");
	});

	test("leaves unknown placeholders empty", () => {
		expect(interpolateOpenCodeTemplate("{env:YOQA_OPENCODE_MISSING_VAR_XYZ}", {})).toBe("");
	});
});

describe("parseOpenCodeCompatibleProvider", () => {
	test("reads LiteLLM OpenAI-compatible gateway settings", () => {
		expect(parseOpenCodeCompatibleProvider(liteLlmConfig, "litellm")).toEqual({
			providerId: "litellm",
			baseURL: "https://litellm.example.test/v1",
			apiKeyTemplate: "{env:YOQA_TEST_LITELLM_API_KEY}",
			headers: {
				"x-litellm-end-user-id": "{env:YOQA_TEST_LITELLM_END_USER_ID}",
			},
		});
	});

	test("ignores native providers without an OpenAI-compatible base URL", () => {
		expect(parseOpenCodeCompatibleProvider(liteLlmConfig, "amazon-bedrock")).toBeNull();
		expect(parseOpenCodeCompatibleProvider(liteLlmConfig, "opencode")).toBeNull();
	});
});

describe("resolveOpenCodeCompatibleAuth", () => {
	test("uses interpolated LiteLLM env and stored key fallback", () => {
		expect(
			resolveOpenCodeCompatibleAuth({
				providerId: "litellm",
				config: liteLlmConfig,
				env: {
					YOQA_TEST_LITELLM_API_KEY: "sk-lite-from-env",
					YOQA_TEST_LITELLM_END_USER_ID: "qa-runner",
				},
				storedKey: "sk-from-auth-json",
				overrideBaseUrl: null,
			}),
		).toEqual({
			baseURL: "https://litellm.example.test/v1",
			apiKey: "sk-lite-from-env",
			headers: { "x-litellm-end-user-id": "qa-runner" },
		});
	});

	test("falls back to OpenCode auth.json key when env template is empty", () => {
		const previousKey = process.env.LITELLM_API_KEY;
		process.env.LITELLM_API_KEY = "";
		try {
			expect(
				resolveOpenCodeCompatibleAuth({
					providerId: "litellm",
					config: liteLlmConfig,
					env: {},
					storedKey: "sk-from-auth-json",
					overrideBaseUrl: null,
				}),
			).toMatchObject({
				baseURL: "https://litellm.example.test/v1",
				apiKey: "sk-from-auth-json",
			});
		} finally {
			process.env.LITELLM_API_KEY = previousKey ?? "";
		}
	});

	test("does not treat Bedrock as OpenAI-compatible even with a base URL override", () => {
		expect(
			resolveOpenCodeCompatibleAuth({
				providerId: "amazon-bedrock",
				config: liteLlmConfig,
				env: {},
				storedKey: "bedrock-key",
				overrideBaseUrl: "https://litellm.example.test/v1",
			}),
		).toBeNull();
	});
});
