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
	) => Promise<{ phases?: { capture?: number; action?: number; settle?: number } }>;
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
		clock?: ScenarioClock;
		advance?: (ms: number) => void;
	},
): Promise<LatencyRunInput> {
	const clock = options.clock ?? { now: () => Date.now() };
	const x = options.x ?? 500;
	const y = options.y ?? 500;
	const tapToResult: number[] = [];
	const screenRead: number[] = [];
	const coldStart: number[] = [];
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
		const tTap = clock.now();
		const result = await driver.tapToResult(x, y);
		options.advance?.(30);
		tapToResult.push(clock.now() - tTap);
		if (result.phases?.capture != null) captures.push(result.phases.capture);
		if (result.phases?.action != null) actions.push(result.phases.action);
		if (result.phases?.settle != null) settles.push(result.phases.settle);
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
		tapToResult,
		screenRead,
		coldStart,
		...(phases ? { phases } : {}),
	};
}
