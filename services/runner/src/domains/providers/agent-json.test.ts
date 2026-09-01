import { describe, expect, test } from "bun:test";
import {
	closeTruncatedJson,
	coerceLooseJson,
	extractAgentJsonObject,
	normalizeVisionJson,
	salvageAgentJsonText,
} from "./agent-json";
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

describe("closeTruncatedJson", () => {
	test("closes an unclosed thoughts string and object", () => {
		const truncated =
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding","thoughts":"The screen shows an onboarding/welcome scr';
		expect(JSON.parse(closeTruncatedJson(truncated))).toEqual({
			type: "tap",
			x: 270,
			y: 1006,
			reason: "Need to get past onboarding",
			thoughts: "The screen shows an onboarding/welcome scr",
		});
	});

	test("drops a trailing comma before closing", () => {
		expect(JSON.parse(coerceLooseJson(closeTruncatedJson('{"type":"tap","x":270,')))).toEqual({
			type: "tap",
			x: 270,
		});
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

	test("parses truncated tap JSON with no closing brace", () => {
		const truncated =
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding screen first before accessing games","thoughts":"The screen shows an onboarding/welcome scr';
		expect(extractAgentJsonObject(truncated, "Model")).toMatchObject({
			type: "tap",
			x: 270,
			y: 1006,
			reason: "Need to get past onboarding screen first before accessing games",
			thoughts: "The screen shows an onboarding/welcome scr",
		});
	});

	test("parses fenced truncated JSON", () => {
		const stdout =
			'```json\n{"type":"wait","ms":1500,"reason":"splash","thoughts":"Still loading\n```';
		expect(extractAgentJsonObject(stdout, "Model")).toMatchObject({
			type: "wait",
			ms: 1500,
			reason: "splash",
		});
	});

	test("throws when no object is present", () => {
		expect(() => extractAgentJsonObject("no object here", "Cursor Agent CLI")).toThrow(
			AgentProviderError,
		);
	});
});

describe("normalizeVisionJson", () => {
	test("clamps coordinates onto the 0–1000 grid", () => {
		expect(normalizeVisionJson({ x: -5, y: 1006 })).toEqual({ x: 0, y: 1000 });
		expect(normalizeVisionJson({ x: 500, y: 800, x2: -1, y2: 1006 })).toEqual({
			x: 500,
			y: 800,
			x2: 0,
			y2: 1000,
		});
	});

	test("fills missing thoughts from reason", () => {
		expect(normalizeVisionJson({ type: "done", reason: "Passed" })).toEqual({
			type: "done",
			reason: "Passed",
			thoughts: "Passed",
		});
	});
});

describe("salvageAgentJsonText", () => {
	test("unwraps markdown-fenced JSON objects", () => {
		expect(
			JSON.parse(
				salvageAgentJsonText(
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
