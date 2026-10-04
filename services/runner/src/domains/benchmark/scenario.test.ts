import { describe, expect, test } from "bun:test";
import { type BenchmarkDriver, runLatencyScenario } from "./scenario";

function fakeDriver(name: "yoqa" | "argent"): BenchmarkDriver & { calls: string[] } {
	const calls: string[] = [];
	return {
		name,
		calls,
		connect: async () => {
			calls.push("connect");
		},
		screen: async () => {
			calls.push("screen");
		},
		tapToResult: async () => {
			calls.push("tap");
			return name === "yoqa"
				? { phases: { capture: 5, action: 10, settle: 15 }, hit: true }
				: { hit: true };
		},
		disconnect: async () => {
			calls.push("disconnect");
		},
	};
}

describe("runLatencyScenario", () => {
	test("connects once, reads the screen and taps N times, then disconnects", async () => {
		let now = 0;
		const driver = fakeDriver("yoqa");
		const result = await runLatencyScenario(driver, {
			repeats: 3,
			clock: {
				now: () => now,
				sleep: async () => undefined,
			},
			advance: (ms) => {
				now += ms;
			},
		});
		expect(driver.calls).toEqual(["connect", "screen", "tap", "tap", "tap", "disconnect"]);
		expect(result.coldStart).toHaveLength(1);
		expect(result.screenRead).toHaveLength(1);
		expect(result.tapToResult).toHaveLength(3);
		expect(result.phases?.action).toEqual([10, 10, 10]);
		expect(result.tapHits).toEqual([true, true, true]);
	});
});
