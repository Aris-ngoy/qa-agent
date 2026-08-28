import { describe, expect, test } from "bun:test";
import type { AgentDecision } from "./agent";
import { buildScriptFromDecisions, parseCaseScript, serializeCaseScript } from "./script";

describe("buildScriptFromDecisions", () => {
	test("keeps tap/type/wait and clamps wait duration", () => {
		const decisions: AgentDecision[] = [
			{ type: "tap", x: 120, y: 340, reason: "Tap CTA", thoughts: "CTA visible" },
			{ type: "type", text: "hello", reason: "Fill field", thoughts: "Field focused" },
			{ type: "wait", ms: 50, reason: "Too short", thoughts: "Splash" },
			{ type: "wait", ms: 9000, reason: "Too long", thoughts: "Loading" },
			{ type: "done", reason: "Finished", thoughts: "Done" },
			{ type: "tap", reason: "Missing coords", thoughts: "Guess center" },
		];

		const script = buildScriptFromDecisions(decisions, "run_1");
		expect(script).not.toBeNull();
		expect(script?.sourceRunId).toBe("run_1");
		expect(script?.actions).toEqual([
			{ type: "tap", x: 120, y: 340, reason: "Tap CTA" },
			{ type: "type", text: "hello", reason: "Fill field" },
			{ type: "wait", ms: 500, reason: "Too short" },
			{ type: "wait", ms: 3000, reason: "Too long" },
			{ type: "tap", x: 500, y: 500, reason: "Missing coords" },
		]);
	});

	test("keeps label taps and alert accept", () => {
		const script = buildScriptFromDecisions(
			[
				{
					type: "tap",
					label: "Allow",
					x: 269,
					y: 951,
					reason: "Grant notifications",
					thoughts: "Dialog",
				},
				{
					type: "alert",
					alertAction: "accept",
					reason: "Accept leftover",
					thoughts: "Still up",
				},
				{ type: "done", reason: "Finished", thoughts: "Done" },
			],
			"run_alert",
		);
		expect(script?.actions).toEqual([
			{ type: "tap", label: "Allow", reason: "Grant notifications" },
			{ type: "alert", alertAction: "accept", reason: "Accept leftover" },
		]);
	});

	test("in-app taps persist screenshot x,y even when a label is present", () => {
		const script = buildScriptFromDecisions(
			[
				{
					type: "tap",
					label: "Login",
					x: 120,
					y: 340,
					reason: "Tap login",
					thoughts: "Login button visible",
				},
			],
			"run_xy",
		);
		expect(script?.actions).toEqual([{ type: "tap", x: 120, y: 340, reason: "Tap login" }]);
	});

	test("returns null when no replayable actions remain", () => {
		expect(
			buildScriptFromDecisions(
				[{ type: "fail", reason: "Broken", thoughts: "Crash dialog" }],
				"run_2",
			),
		).toBeNull();
	});
});

describe("parseCaseScript / serializeCaseScript", () => {
	test("round-trips valid JSON and rejects invalid payloads", () => {
		const script = {
			version: 1 as const,
			savedAt: 99,
			actions: [{ type: "tap" as const, x: 1, y: 2 }],
		};
		const raw = serializeCaseScript(script);
		expect(parseCaseScript(raw)).toEqual(script);
		expect(parseCaseScript(null)).toBeNull();
		expect(parseCaseScript("{not-json")).toBeNull();
		expect(parseCaseScript(JSON.stringify({ version: 1, savedAt: 1, actions: [] }))).toBeNull();
	});
});
