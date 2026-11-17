/**
 * **Emitted usage**: Yoqa's own estimate of what its Agent output cost a calling agent.
 * Pure — no ledger, no runner, no clock. These tests are the formula's contract.
 */

import { describe, expect, test } from "bun:test";
import {
	DEFAULT_OUTPUT_BUDGET,
	deviceSessionId,
	estimateImageTokens,
	estimateTextTokens,
	formatEmittedUsage,
	resolveOutputBudget,
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
