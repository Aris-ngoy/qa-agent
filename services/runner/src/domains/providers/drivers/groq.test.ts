import { describe, expect, test } from "bun:test";
import { formatProviderHttpError } from "../vision-model";

const STRICT_SCHEMA_BODY = JSON.stringify({
	error: {
		message:
			"invalid JSON schema for response_format: 'response': /required: `required` is required to be supplied and to be an array including every key in properties: alertAction, appId, assertion, description, direction, double, durationMs, id, label, ms, seconds, text, timeoutMs, url, x, x2, y, y2.",
		type: "invalid_request_error",
	},
});

describe("Groq strict-schema error mapping", () => {
	test("strict-schema 400 maps to prompt-JSON guidance without echoing the payload", () => {
		const message = formatProviderHttpError("Groq", 400, STRICT_SCHEMA_BODY);
		expect(message.toLowerCase()).toContain("prompt");
		expect(message.toLowerCase()).toContain("json");
		expect(message).not.toContain("alertAction");
		expect(message).not.toContain("invalid_request_error");
		expect(message).not.toContain(STRICT_SCHEMA_BODY.slice(0, 20));
	});

	test("non-strict Groq errors keep status prefix and body", () => {
		const body = JSON.stringify({ error: { message: "rate limit exceeded" } });
		const message = formatProviderHttpError("Groq", 429, body);
		expect(message).toBe(`Groq request failed (429): ${body.slice(0, 400)}`);
	});

	test("strict-schema body at non-400 status keeps status prefix", () => {
		const message = formatProviderHttpError("Groq", 500, STRICT_SCHEMA_BODY);
		expect(message.startsWith("Groq request failed (500):")).toBe(true);
	});
});
