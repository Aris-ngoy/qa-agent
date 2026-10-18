import { describe, expect, test } from "bun:test";
import { scriptActionSummary } from "./script-summary";

describe("scriptActionSummary", () => {
	test("describes a Branch on text or id in one row", () => {
		expect(
			scriptActionSummary({
				type: "branch",
				text: "Allow notifications",
				assertion: "visible",
				then: [{ type: "tap", label: "Allow" }],
				else: [
					{ type: "wait", ms: 500 },
					{ type: "tap", label: "Skip" },
				],
			}),
		).toBe("If “Allow notifications” visible → 1 step, else 2 steps");
		expect(
			scriptActionSummary({
				type: "branch",
				id: "onboarding-skip",
				assertion: "not-visible",
				then: [{ type: "tap", label: "Next" }],
			}),
		).toBe("If #onboarding-skip not visible → 1 step");
	});
});
