import { describe, expect, test } from "bun:test";
import { extractAgentJsonObject } from "../providers/agent-json";
import { parseAgentDecision } from "./agent";

describe("parseAgentDecision", () => {
	test("clamps a tap whose y overshoots the 0–1000 grid", () => {
		const raw = extractAgentJsonObject(
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding screen first before accessing games","thoughts":"The screen shows an onboarding/welcome screen"}',
			"Model",
		);
		expect(parseAgentDecision(raw)).toMatchObject({
			type: "tap",
			x: 270,
			y: 1000,
			reason: "Need to get past onboarding screen first before accessing games",
		});
	});

	test("salvages truncated thoughts and still returns a tap", () => {
		const raw = extractAgentJsonObject(
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding screen first before accessing games","thoughts":"The screen shows an onboarding/welcome scr',
			"Model",
		);
		const decision = parseAgentDecision(raw);
		expect(decision.type).toBe("tap");
		expect(decision.x).toBe(270);
		expect(decision.y).toBe(1000);
		expect(decision.thoughts.startsWith("The screen shows an onboarding")).toBe(true);
	});
});
