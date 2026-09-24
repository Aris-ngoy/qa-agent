import { describe, expect, test } from "bun:test";
import { formatProviderHttpError, providerOptionsForVision } from "./vision-model";

describe("Groq strict-schema compat (#123 repro)", () => {
	test("Groq vision uses non-strict JSON provider options", () => {
		expect(providerOptionsForVision("Groq")).toEqual({ groq: { structuredOutputs: false } });
	});

	test("other Providers keep default structured output behavior", () => {
		expect(providerOptionsForVision("OpenAI")).toBeUndefined();
		expect(providerOptionsForVision("Anthropic")).toBeUndefined();
	});

	test("Groq strict-schema 400 maps to an actionable error", () => {
		const body = `{"error":{"message":"invalid JSON schema for response_format: 'response': /required: \`required\` is required to be supplied and to be an array including every key in properties.","type":"invalid_request_error"}}`;
		const message = formatProviderHttpError("Groq", 400, body);
		expect(message).toContain("Groq");
		expect(message.toLowerCase()).toContain("json");
		expect(message).not.toContain("invalid_request_error");
	});
});
