import { describe, expect, test } from "bun:test";
import {
	formatLatencyTable,
	percentile,
	recommendScreenDefault,
	summarizeLatency,
	summarizeSamples,
} from "./summarize";

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

	test("accuracy and pass-rate rows use hits over n", () => {
		const report = summarizeLatency({
			recordedAt: "2026-10-04T00:00:00.000Z",
			repeats: 5,
			suiteVersion: 1,
			runs: [
				{
					tool: "yoqa",
					platform: "ios",
					tapToResult: [100],
					screenRead: [40],
					coldStart: [800],
					tapHits: [true, true, true, false, true],
					casePasses: [true, true, false],
				},
			],
		});
		expect(report.suiteVersion).toBe(1);
		expect(report.results[0]?.accuracy).toEqual({ hits: 4, n: 5, rate: 0.8 });
		expect(report.results[0]?.passRate).toEqual({ hits: 2, n: 3, rate: 2 / 3 });
		const table = formatLatencyTable(report);
		expect(table).toContain("tapAccuracy");
		expect(table).toContain("casePassRate");
		expect(table).toContain("0.80");
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

describe("recommendScreenDefault", () => {
	test("keeps vision when a tree arm has no Case pass-rate samples", () => {
		const report = summarizeLatency({
			recordedAt: "2026-10-04T00:00:00.000Z",
			repeats: 3,
			runs: [
				{
					tool: "yoqa",
					platform: "android",
					screenMode: "vision",
					tapToResult: [100],
					screenRead: [40],
					coldStart: [800],
					tapHits: [true, true],
				},
				{
					tool: "yoqa",
					platform: "android",
					screenMode: "tree",
					tapToResult: [140],
					screenRead: [80],
					coldStart: [800],
					tapHits: [true, true],
				},
			],
		});
		expect(recommendScreenDefault(report.results[0], report.results[1])).toEqual({
			screenMode: "vision",
			reason: "No Case pass-rate samples; keep vision-first",
		});
		expect(formatLatencyTable(report)).toContain("yoqa/tree");
	});

	test("picks tree only when it wins pass rate without losing accuracy", () => {
		const vision = {
			tool: "yoqa" as const,
			platform: "android" as const,
			screenMode: "vision" as const,
			metrics: {
				tapToResult: { p50: 100, p95: 100, n: 1, samples: [100] },
				screenRead: { p50: 40, p95: 40, n: 1, samples: [40] },
				coldStart: { p50: 800, p95: 800, n: 1, samples: [800] },
			},
			accuracy: { hits: 4, n: 5, rate: 0.8 },
			passRate: { hits: 1, n: 3, rate: 1 / 3 },
		};
		const tree = {
			...vision,
			screenMode: "tree" as const,
			accuracy: { hits: 4, n: 5, rate: 0.8 },
			passRate: { hits: 3, n: 3, rate: 1 },
		};
		expect(recommendScreenDefault(vision, tree).screenMode).toBe("tree");
		expect(
			recommendScreenDefault(vision, { ...tree, accuracy: { hits: 2, n: 5, rate: 0.4 } })
				.screenMode,
		).toBe("vision");
	});
});

describe("summarizeSamples", () => {
	test("empty input is n=0", () => {
		expect(summarizeSamples([])).toEqual({ p50: 0, p95: 0, n: 0, samples: [] });
	});
});
