export type BenchmarkTool = "yoqa" | "argent";
export type BenchmarkPlatform = "ios" | "android";
export type BenchmarkMetric = "tapToResult" | "screenRead" | "coldStart";

export type SampleSummary = {
	p50: number;
	p95: number;
	n: number;
	samples: number[];
};

export type RateSummary = {
	hits: number;
	n: number;
	rate: number;
};

export type LatencyRunInput = {
	tool: BenchmarkTool;
	platform: BenchmarkPlatform;
	tapToResult: number[];
	screenRead: number[];
	coldStart: number[];
	tapHits?: boolean[];
	casePasses?: boolean[];
	phases?: {
		capture?: number[];
		action?: number[];
		settle?: number[];
	};
};

export type LatencyReport = {
	recordedAt: string;
	repeats: number;
	suiteVersion?: number;
	results: Array<{
		tool: BenchmarkTool;
		platform: BenchmarkPlatform;
		metrics: Record<BenchmarkMetric, SampleSummary>;
		accuracy?: RateSummary;
		passRate?: RateSummary;
		phases?: { capture?: number; action?: number; settle?: number };
	}>;
};

/** Nearest-rank percentile of an already-or-not sorted series. Empty → 0. */
export function percentile(samples: readonly number[], p: number): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0;
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
	return {
		p50: percentile(samples, 50),
		p95: percentile(samples, 95),
		n: samples.length,
		samples: [...samples],
	};
}

function mean(samples: readonly number[] | undefined): number | undefined {
	if (!samples || samples.length === 0) return undefined;
	return samples.reduce((sum, n) => sum + n, 0) / samples.length;
}

export function summarizeRate(hits: readonly boolean[] | undefined): RateSummary | undefined {
	if (!hits || hits.length === 0) return undefined;
	const n = hits.length;
	const count = hits.filter(Boolean).length;
	return { hits: count, n, rate: count / n };
}

export function summarizeLatency(input: {
	recordedAt: string;
	repeats: number;
	suiteVersion?: number;
	runs: LatencyRunInput[];
}): LatencyReport {
	return {
		recordedAt: input.recordedAt,
		repeats: input.repeats,
		...(input.suiteVersion != null ? { suiteVersion: input.suiteVersion } : {}),
		results: input.runs.map((run) => {
			const capture = mean(run.phases?.capture);
			const action = mean(run.phases?.action);
			const settle = mean(run.phases?.settle);
			const phases =
				capture != null || action != null || settle != null
					? {
							...(capture != null ? { capture } : {}),
							...(action != null ? { action } : {}),
							...(settle != null ? { settle } : {}),
						}
					: undefined;
			const accuracy = summarizeRate(run.tapHits);
			const passRate = summarizeRate(run.casePasses);
			return {
				tool: run.tool,
				platform: run.platform,
				metrics: {
					tapToResult: summarizeSamples(run.tapToResult),
					screenRead: summarizeSamples(run.screenRead),
					coldStart: summarizeSamples(run.coldStart),
				},
				...(accuracy ? { accuracy } : {}),
				...(passRate ? { passRate } : {}),
				...(phases ? { phases } : {}),
			};
		}),
	};
}

export function formatLatencyTable(report: LatencyReport): string {
	const header = [
		"tool".padEnd(8),
		"platform".padEnd(10),
		"metric".padEnd(14),
		"p50".padStart(8),
		"p95".padStart(8),
		"n".padStart(4),
	].join(" ");
	const lines = [header];
	for (const row of report.results) {
		for (const metric of ["tapToResult", "screenRead", "coldStart"] as const) {
			const s = row.metrics[metric];
			lines.push(
				[
					row.tool.padEnd(8),
					row.platform.padEnd(10),
					metric.padEnd(14),
					String(Math.round(s.p50)).padStart(8),
					String(Math.round(s.p95)).padStart(8),
					String(s.n).padStart(4),
				].join(" "),
			);
		}
		if (row.accuracy) {
			lines.push(
				[
					row.tool.padEnd(8),
					row.platform.padEnd(10),
					"tapAccuracy".padEnd(14),
					row.accuracy.rate.toFixed(2).padStart(8),
					"".padStart(8),
					String(row.accuracy.n).padStart(4),
				].join(" "),
			);
		}
		if (row.passRate) {
			lines.push(
				[
					row.tool.padEnd(8),
					row.platform.padEnd(10),
					"casePassRate".padEnd(14),
					row.passRate.rate.toFixed(2).padStart(8),
					"".padStart(8),
					String(row.passRate.n).padStart(4),
				].join(" "),
			);
		}
		if (row.phases) {
			const parts = Object.entries(row.phases).map(([k, v]) => `${k}=${Math.round(v)}`);
			lines.push(`         phases ${parts.join(" ")}`);
		}
	}
	return `${lines.join("\n")}\n`;
}
