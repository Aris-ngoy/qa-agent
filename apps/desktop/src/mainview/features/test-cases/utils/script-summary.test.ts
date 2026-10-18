import { describe, expect, test } from "bun:test";
import { describeBranch, scriptActionSummary } from "./script-summary";

describe("scriptActionSummary", () => {
	test("describes a Branch in one row with both sides", () => {
		expect(
			scriptActionSummary({
				type: "branch",
				text: "Allow notifications",
				assertion: "visible",
				then: [{ type: "tap", label: "Allow" }],
				else: [{ type: "wait", ms: 500 }],
			}),
		).toBe("If “Allow notifications” visible → 1 step, else 1 step");
	});

	test("words a not-visible Branch with no else", () => {
		expect(
			scriptActionSummary({
				type: "branch",
				text: "Loading",
				assertion: "not-visible",
				then: [
					{ type: "tap", label: "Continue" },
					{ type: "assert", text: "Home", assertion: "visible" },
				],
			}),
		).toBe("If “Loading” not visible → 2 steps");
	});

	test("counts a nested Branch as one step of its side", () => {
		expect(
			scriptActionSummary({
				type: "branch",
				text: "Welcome",
				assertion: "visible",
				then: [
					{
						type: "branch",
						text: "Skip",
						assertion: "visible",
						then: [{ type: "tap", label: "Skip" }],
					},
				],
			}),
		).toBe("If “Welcome” visible → 1 step");
	});

	test("names a Branch's id like a tap by id", () => {
		expect(
			scriptActionSummary({
				type: "branch",
				id: "onboarding-skip",
				assertion: "not-visible",
				then: [{ type: "tap", label: "Next" }],
			}),
		).toBe("If #onboarding-skip not visible → 1 step");
	});

	test("keeps the other actions' wording", () => {
		expect(scriptActionSummary({ type: "tap", label: "Home" })).toBe("Tap “Home”");
		expect(scriptActionSummary({ type: "assert", text: "Home", assertion: "visible" })).toBe(
			"Assert visible: “Home”",
		);
		expect(scriptActionSummary({ type: "wait", ms: 500 })).toBe("Wait 500ms");
	});
});

describe("describeBranch", () => {
	test("splits a Branch into what it checks and its sides", () => {
		expect(
			describeBranch({
				type: "branch",
				text: "Rate this app",
				assertion: "visible",
				then: [{ type: "tap", label: "Not now" }],
				else: [
					{ type: "wait", ms: 500 },
					{ type: "tap", label: "Skip" },
				],
			}),
		).toEqual({ check: "“Rate this app” visible", sides: "1 step, else 2 steps" });
	});
});
