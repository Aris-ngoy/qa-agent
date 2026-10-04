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

	test("stamps the Screen arm and records Case step counts", async () => {
		const driver = fakeDriver("yoqa");
		driver.runCase = async () => ({ passed: true, steps: 8 });
		const result = await runLatencyScenario(driver, {
			repeats: 1,
			screenMode: "tree",
			suite: {
				version: 1,
				repeats: 1,
				taps: [{ x: 500, y: 500 }],
				cases: [{ caseId: "case_1" }],
				passRepeats: 1,
				arms: ["tree"],
			},
		});
		expect(result.screenMode).toBe("tree");
		expect(result.casePasses).toEqual([true]);
		expect(result.stepCounts).toEqual([8]);
	});
});
