import type { BenchmarkSuite } from "./suite";
import type { BenchmarkPlatform, BenchmarkTool, LatencyRunInput } from "./summarize";

export type ScenarioClock = {
	now: () => number;
	sleep?: (ms: number) => Promise<void>;
};

export type BenchmarkDriver = {
	name: BenchmarkTool;
	connect: () => Promise<void>;
	screen: () => Promise<void>;
	tapToResult: (
		x: number,
		y: number,
		expect?: { id?: string; label?: string },
	) => Promise<{
		phases?: { capture?: number; action?: number; settle?: number };
		hit?: boolean;
	}>;
	runCase?: (caseId: string) => Promise<boolean | { passed: boolean; steps?: number }>;
	disconnect: () => Promise<void>;
};

/**
 * Drive one tool through the connector scenario: connect (cold start), one
 * screen read, then `repeats` tap-to-result Actions. The driver is the seam;
 * live Yoqa / Argent adapters live outside this module.
 */
export async function runLatencyScenario(
	driver: BenchmarkDriver,
	options: {
		repeats: number;
		platform?: BenchmarkPlatform;
		x?: number;
		y?: number;
		suite?: BenchmarkSuite;
		screenMode?: "vision" | "tree";
		clock?: ScenarioClock;
		advance?: (ms: number) => void;
	},
): Promise<LatencyRunInput> {
	const clock = options.clock ?? { now: () => Date.now() };
	const taps = options.suite?.taps ?? [{ x: options.x ?? 500, y: options.y ?? 500 }];
	const tapToResult: number[] = [];
	const screenRead: number[] = [];
	const coldStart: number[] = [];
	const tapHits: boolean[] = [];
	const casePasses: boolean[] = [];
	const stepCounts: number[] = [];
	const captures: number[] = [];
	const actions: number[] = [];
	const settles: number[] = [];

	const t0 = clock.now();
	await driver.connect();
	options.advance?.(50);
	coldStart.push(clock.now() - t0);

	const tScreen = clock.now();
	await driver.screen();
	options.advance?.(20);
	screenRead.push(clock.now() - tScreen);

	for (let i = 0; i < options.repeats; i++) {
		const tap = taps[i % taps.length];
		if (!tap) continue;
		const tTap = clock.now();
		const result = await driver.tapToResult(tap.x, tap.y, {
			id: tap.id,
			label: tap.label,
		});
		options.advance?.(30);
		tapToResult.push(clock.now() - tTap);
		if (result.hit != null) tapHits.push(result.hit);
		if (result.phases?.capture != null) captures.push(result.phases.capture);
		if (result.phases?.action != null) actions.push(result.phases.action);
		if (result.phases?.settle != null) settles.push(result.phases.settle);
	}

	if (driver.runCase && options.suite) {
		const times = options.suite.passRepeats;
		for (let i = 0; i < times; i++) {
			for (const item of options.suite.cases) {
				const outcome = await driver.runCase(item.caseId);
				const passed = typeof outcome === "boolean" ? outcome : outcome.passed;
				casePasses.push(passed);
				if (typeof outcome !== "boolean" && outcome.steps != null) {
					stepCounts.push(outcome.steps);
				}
			}
		}
	}

	await driver.disconnect();

	const phases =
		driver.name === "yoqa" && (captures.length || actions.length || settles.length)
			? {
					...(captures.length ? { capture: captures } : {}),
					...(actions.length ? { action: actions } : {}),
					...(settles.length ? { settle: settles } : {}),
				}
			: undefined;

	return {
		tool: driver.name,
		platform: options.platform ?? "ios",
		...(options.screenMode ? { screenMode: options.screenMode } : {}),
		tapToResult,
		screenRead,
		coldStart,
		...(tapHits.length ? { tapHits } : {}),
		...(casePasses.length ? { casePasses } : {}),
		...(stepCounts.length ? { stepCounts } : {}),
		...(phases ? { phases } : {}),
	};
}
