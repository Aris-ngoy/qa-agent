import { describe, expect, test } from "bun:test";
import { coerceLooseJson, extractAgentJsonObject } from "./agent-json";
import { AgentProviderError } from "./vision-model";

describe("coerceLooseJson", () => {
	test("converts single-quoted keys and strings to strict JSON", () => {
		const loose = "{'type':'tap','x':120,'y':340,'reason':'Tap CTA','thoughts':'Button visible'}";
		expect(JSON.parse(coerceLooseJson(loose))).toEqual({
			type: "tap",
			x: 120,
			y: 340,
			reason: "Tap CTA",
			thoughts: "Button visible",
		});
	});

	test("preserves apostrophes inside already double-quoted strings", () => {
		const mixed = `{"reason":"don't tap twice","thoughts":"it's loading"}`;
		expect(coerceLooseJson(mixed)).toBe(mixed);
		expect(JSON.parse(coerceLooseJson(mixed))).toEqual({
			reason: "don't tap twice",
			thoughts: "it's loading",
		});
	});

	test("drops trailing commas", () => {
		const loose = `{"type":"wait","ms":1000,}`;
		expect(JSON.parse(coerceLooseJson(loose))).toEqual({ type: "wait", ms: 1000 });
	});
});

describe("extractAgentJsonObject", () => {
	test("parses fenced single-quoted object literals", () => {
		const stdout = "Here you go:\n```json\n{'type':'done','reason':'ok','thoughts':'done'}\n```\n";
		expect(extractAgentJsonObject(stdout, "Cursor Agent CLI")).toEqual({
			type: "done",
			reason: "ok",
			thoughts: "done",
		});
	});

	test("throws when no object is present", () => {
		expect(() => extractAgentJsonObject("no object here", "Cursor Agent CLI")).toThrow(
			AgentProviderError,
		);
	});
});
