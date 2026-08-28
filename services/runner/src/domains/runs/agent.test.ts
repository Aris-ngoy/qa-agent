import { describe, expect, test } from "bun:test";
import { extractAgentJsonObject } from "../providers/agent-json";
import { isSystemPermissionLabel, parseAgentDecision, prefersScreenshotTap } from "./agent";

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

	test("parses a label tap and an accept-alert action", () => {
		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"tap","label":"Allow","reason":"Grant notifications","thoughts":"Permission dialog is visible with Allow"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "tap",
			label: "Allow",
			reason: "Grant notifications",
		});

		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"alert","alertAction":"accept","reason":"Accept the permission","thoughts":"System Allow dialog is on screen"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "alert",
			alertAction: "accept",
		});
	});
});

describe("prefersScreenshotTap", () => {
	test("in-app coords win even when a label is also present", () => {
		expect(prefersScreenshotTap({ x: 120, y: 340, label: "Login" })).toBe(true);
		expect(prefersScreenshotTap({ x: 120, y: 340 })).toBe(true);
	});

	test("permission labels keep locator taps", () => {
		expect(isSystemPermissionLabel("Allow")).toBe(true);
		expect(isSystemPermissionLabel("Don't allow")).toBe(true);
		expect(prefersScreenshotTap({ x: 269, y: 951, label: "Allow" })).toBe(false);
		expect(prefersScreenshotTap({ label: "Allow" })).toBe(false);
	});
});
