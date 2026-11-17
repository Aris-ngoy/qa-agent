/**
 * **Emitted usage**: Yoqa's own estimate of what its Agent output cost a calling agent.
 * Pure — no ledger, no runner, no clock. These tests are the formula's contract.
 */

import { describe, expect, test } from "bun:test";
import {
	DEFAULT_OUTPUT_BUDGET,
	DEFAULT_WARN_AT_PERCENT,
	budgetWarning,
	deviceSessionId,
	estimateImageTokens,
	estimateTextTokens,
	formatEmittedUsage,
	outputWarningSuppressed,
	resolveOutputBudget,
	resolveWarnAtPercent,
} from "./emitted-usage";

describe("estimating what emitted text cost", () => {
	test("counts four characters to the token, the common published approximation", () => {
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcdefgh")).toBe(2);
	});

	test("rounds a part-token up, because a fragment still costs one", () => {
		expect(estimateTextTokens("a")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});

	test("costs nothing for text that was never written", () => {
		expect(estimateTextTokens("")).toBe(0);
	});
});

describe("estimating what a named Agent image will cost", () => {
	test("divides its pixels by the published approximation of 750 to a token", () => {
		// 1000×750 = 750,000 px, exactly 1000 tokens by the documented divisor.
		expect(estimateImageTokens({ width: 1000, height: 750 })).toBe(1000);
		// A 390×844 phone Agent image: 329,160 px.
		expect(estimateImageTokens({ width: 390, height: 844 })).toBe(439);
	});

	test("costs nothing when the command named no image", () => {
		expect(estimateImageTokens(undefined)).toBe(0);
	});

	test("costs nothing for dimensions that cannot be believed", () => {
		expect(estimateImageTokens({ width: 0, height: 844 })).toBe(0);
		expect(estimateImageTokens({ width: -1, height: -1 })).toBe(0);
		expect(estimateImageTokens({ width: Number.NaN, height: 10 })).toBe(0);
	});
});

describe("the Output budget the total is reported against", () => {
	test("defaults to 250k, a product convention rather than any model's window", () => {
		expect(resolveOutputBudget({})).toBe(250_000);
		expect(DEFAULT_OUTPUT_BUDGET).toBe(250_000);
	});

	test("takes the environment's number, so a 1M-window model is not held to the default", () => {
		expect(resolveOutputBudget({ YOQA_OUTPUT_BUDGET: "1000000" })).toBe(1_000_000);
	});

	test("ignores a value it cannot believe rather than reporting against nonsense", () => {
		for (const bad of ["", "lots", "0", "-1", "12.5"]) {
			expect(resolveOutputBudget({ YOQA_OUTPUT_BUDGET: bad })).toBe(250_000);
		}
	});
});

describe("the Emitted usage report an engineer or their agent reads", () => {
	const report = (total: number, byCommand: { command: string; tokens: number; calls: number }[]) =>
		formatEmittedUsage(
			{ session: "ios-sim-ABC@1700000000000", total, byCommand },
			{ budget: 250_000 },
		).split("\n");

	test("leads with the total against the budget, as a share of the window", () => {
		expect(report(25_000, [{ command: "screen", tokens: 25_000, calls: 30 }])[0]).toBe(
			"Emitted 25,000 of 250,000 tokens (10%) — Device Session ios-sim-ABC@1700000000000",
		);
	});

	test("breaks the total down per command, dearest first, with how many calls it took", () => {
		expect(
			report(1_120, [
				{ command: "action tap", tokens: 900, calls: 3 },
				{ command: "screen", tokens: 220, calls: 2 },
			]).slice(1),
		).toEqual(["  action tap   900 (3 calls)", "  screen       220 (2 calls)"]);
	});

	test("says 1 call in the singular, because a report is read by people too", () => {
		expect(report(220, [{ command: "screen", tokens: 220, calls: 1 }])[1]).toBe(
			"  screen   220 (1 call)",
		);
	});

	test("says plainly that a session has emitted nothing, rather than printing an empty table", () => {
		expect(report(0, [])).toEqual([
			"Emitted 0 of 250,000 tokens (0%) — Device Session ios-sim-ABC@1700000000000",
			"Nothing emitted for this Device Session yet.",
		]);
	});

	test("reports a session over its budget without hiding it, because the budget never blocks", () => {
		expect(report(300_000, [{ command: "screen", tokens: 300_000, calls: 400 }])[0]).toBe(
			"Emitted 300,000 of 250,000 tokens (120%) — Device Session ios-sim-ABC@1700000000000",
		);
	});

	test("says there is nothing to account when no Device Session is connected", () => {
		expect(formatEmittedUsage(null, { budget: 250_000 })).toBe(
			"No active Device Session, so nothing is being accounted.",
		);
	});
});

describe("the Device Session a total is accounted to", () => {
	test("names the device and when it connected, so the next connect is a different session", () => {
		expect(deviceSessionId({ deviceId: "sim-ABC", connectedAt: 1_700_000_000_000 })).toBe(
			"sim-ABC@1700000000000",
		);
		expect(deviceSessionId({ deviceId: "sim-ABC", connectedAt: 1_700_000_009_999 })).not.toBe(
			deviceSessionId({ deviceId: "sim-ABC", connectedAt: 1_700_000_000_000 }),
		);
	});
});

describe("the warning on crossing the Output budget threshold", () => {
	// 80% of a 250,000-token budget: the high-water mark sits at 200,000.
	const budget = { budget: 250_000, warnAtPercent: 80 };

	test("says nothing while the total is still below the high-water mark", () => {
		expect(budgetWarning({ before: 100_000, after: 199_999, ...budget })).toBeNull();
	});

	test("names the total, the budget, and both remedies on the crossing", () => {
		expect(budgetWarning({ before: 199_000, after: 203_418, ...budget })).toBe(
			"Yoqa has emitted 203,418 of 250,000 tokens (81%) into this context — delegate further exploration to a sub-agent, or compact.",
		);
	});

	test("says nothing again for a later command in the same band", () => {
		expect(budgetWarning({ before: 203_418, after: 240_000, ...budget })).toBeNull();
	});

	test("warns again on reaching the budget itself, the figure the warning is about", () => {
		// The high-water mark is 200,000 and the budget is 250,000: a session that runs out of
		// the window it was warned about has to be told, or the first line was the only one.
		expect(budgetWarning({ before: 249_000, after: 250_000, ...budget })).toBe(
			"Yoqa has emitted 250,000 of 250,000 tokens (100%) into this context — delegate further exploration to a sub-agent, or compact.",
		);
	});

	test("then once per further budget's worth, so a runaway session keeps being told", () => {
		expect(budgetWarning({ before: 260_000, after: 400_000, ...budget })).toBeNull();
		expect(budgetWarning({ before: 400_000, after: 500_000, ...budget })).toContain("(200%)");
		expect(budgetWarning({ before: 500_000, after: 600_000, ...budget })).toBeNull();
		expect(budgetWarning({ before: 600_000, after: 750_000, ...budget })).toContain("(300%)");
	});

	test("warns on the command that skips a mark outright, never silently", () => {
		// One enormous emission from nothing, past both the mark and the budget in one go.
		expect(budgetWarning({ before: 0, after: 500_000, ...budget })).toContain("500,000");
	});

	test("stays silent for a threshold or budget that cannot describe a mark", () => {
		expect(budgetWarning({ before: 0, after: 1_000, budget: 0, warnAtPercent: 80 })).toBeNull();
	});
});

describe("the threshold and the switch that turns the warning off", () => {
	test("warns at 80% of the budget unless the environment says otherwise", () => {
		expect(resolveWarnAtPercent({})).toBe(DEFAULT_WARN_AT_PERCENT);
		expect(DEFAULT_WARN_AT_PERCENT).toBe(80);
	});

	test("reads the threshold as a percent of the budget, not a token count", () => {
		expect(resolveWarnAtPercent({ YOQA_OUTPUT_WARN_AT: "50" })).toBe(50);
	});

	test("keeps the default rather than guessing at an unusable threshold", () => {
		expect(resolveWarnAtPercent({ YOQA_OUTPUT_WARN_AT: "half" })).toBe(DEFAULT_WARN_AT_PERCENT);
		expect(resolveWarnAtPercent({ YOQA_OUTPUT_WARN_AT: "0" })).toBe(DEFAULT_WARN_AT_PERCENT);
		expect(resolveWarnAtPercent({ YOQA_OUTPUT_WARN_AT: "-10" })).toBe(DEFAULT_WARN_AT_PERCENT);
		expect(resolveWarnAtPercent({ YOQA_OUTPUT_WARN_AT: "72.5" })).toBe(DEFAULT_WARN_AT_PERCENT);
	});

	test("is not suppressed by default — a silent budget is no budget", () => {
		expect(outputWarningSuppressed({})).toBe(false);
	});

	test("is suppressed by the same words that turn autostart off, for CI", () => {
		expect(outputWarningSuppressed({ YOQA_NO_OUTPUT_WARNING: "1" })).toBe(true);
		expect(outputWarningSuppressed({ YOQA_NO_OUTPUT_WARNING: "true" })).toBe(true);
		expect(outputWarningSuppressed({ YOQA_NO_OUTPUT_WARNING: " YES " })).toBe(true);
		expect(outputWarningSuppressed({ YOQA_NO_OUTPUT_WARNING: "0" })).toBe(false);
	});
});
