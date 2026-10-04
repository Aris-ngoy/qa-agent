import { describe, expect, test } from "bun:test";
import { formatLatencyTable, percentile, summarizeLatency, summarizeSamples } from "./summarize";

describe("percentile", () => {
	test("p50 and p95 of a known series", () => {
		// 10 samples: 10, 20, …, 100. Nearest-rank: p50 → 50, p95 → 100.
		const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
		expect(percentile(samples, 50)).toBe(50);
		expect(percentile(samples, 95)).toBe(100);
	});

	test("a single sample is both p50 and p95", () => {
		expect(percentile([42], 50)).toBe(42);
		expect(percentile([42], 95)).toBe(42);
	});
});

describe("summarizeLatency", () => {
	test("groups by tool and platform and keeps Yoqa phase averages", () => {
		const report = summarizeLatency({
			recordedAt: "2026-10-03T00:00:00.000Z",
			repeats: 3,
			runs: [
				{
					tool: "yoqa",
					platform: "ios",
					tapToResult: [100, 200, 300],
					screenRead: [40, 50, 60],
					coldStart: [1000],
					phases: { capture: [10, 10, 10], action: [20, 30, 40], settle: [70, 80, 90] },
				},
				{
					tool: "argent",
					platform: "ios",
					tapToResult: [40, 50, 60],
					screenRead: [10, 12, 14],
					coldStart: [400],
				},
			],
		});
		expect(report.results[0]?.metrics.tapToResult.p50).toBe(200);
		expect(report.results[0]?.metrics.tapToResult.p95).toBe(300);
		expect(report.results[0]?.phases?.action).toBe(30);
		expect(report.results[1]?.tool).toBe("argent");
		expect(report.results[1]?.phases).toBeUndefined();
	});
});

describe("formatLatencyTable", () => {
	test("prints p50/p95 per metric per tool", () => {
		const table = formatLatencyTable(
			summarizeLatency({
				recordedAt: "2026-10-03T00:00:00.000Z",
				repeats: 3,
				runs: [
					{
						tool: "yoqa",
						platform: "android",
						tapToResult: [120, 180, 240],
						screenRead: [30, 30, 30],
						coldStart: [800],
					},
				],
			}),
		);
		expect(table).toContain("yoqa");
		expect(table).toContain("android");
		expect(table).toContain("tapToResult");
		expect(table).toContain("180");
		expect(table).toContain("240");
	});
});

describe("summarizeSamples", () => {
	test("empty input is n=0", () => {
		expect(summarizeSamples([])).toEqual({ p50: 0, p95: 0, n: 0, samples: [] });
	});
});
