import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
import type { StartYoqaAx, YoqaAx } from "./yoqa-ax";
import { type SpawnYoqaSim, type YoqaSim, YoqaSimUnreachableError } from "./yoqa-sim";

const UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";

function png(shade: number): Uint8Array {
	const rgba = new Uint8Array([shade, shade, shade, 255]);
	return new Uint8Array(encodeRgbaPng({ width: 1, height: 1, rgba }));
}

const IDB_FRAME = png(10);
const SIM_FRAME = png(200);

function ok(stdout = "", stdoutBytes?: Uint8Array): IdbResult {
	return { stdout, stderr: "", exitCode: 0, stdoutBytes };
}

/** Input that reached idb_companion, as `ui …` argument lists. */
const idbInput: string[][] = [];

function fakeIdb(): IdbExec {
	idbInput.length = 0;
	return async (args) => {
		if (args[0] === "ui" || args[0] === "launch") idbInput.push(args.slice(0, 4));
		if (args[0] === "describe") {
			return ok(
				JSON.stringify({
					target_type: "simulator",
					screen_dimensions: { width_points: 402, height_points: 874 },
				}),
			);
		}
		if (args[0] === "screenshot") return ok("", IDB_FRAME);
		if (args[1] === "describe-all") return ok("[]");
		return ok();
	};
}

type FakeSims = {
	spawn: SpawnYoqaSim;
	spawned: string[];
	running: () => number;
	/** Input that reached yoqa-sim, in 0.0–1.0. */
	input: unknown[][];
	/** The running yoqa-sim crashes: every call fails from now on. */
	crash: () => void;
	/** yoqa-sim answers the next call with an error, after it may have touched the screen. */
	refuseNext: () => void;
};

function fakeSims(options: { failSpawn?: boolean; noStream?: boolean } = {}): FakeSims {
	const spawned: string[] = [];
	let running = 0;
	let crashed = false;
	const input: unknown[][] = [];
	let refuse = false;
	const alive = () => {
		if (crashed) throw new YoqaSimUnreachableError("fetch failed: Connection refused");
		if (refuse) {
			refuse = false;
			throw new Error("yoqa-sim tap: 500 the simulator did not take the touch within 1 s");
		}
	};
	const spawn: SpawnYoqaSim = async (udid) => {
		spawned.push(udid);
		await Bun.sleep(5);
		if (options.failSpawn) throw new Error("yoqa-sim exited before api_ready");
		running += 1;
		let stopped = false;
		const sim: YoqaSim = {
			url: "http://127.0.0.1:50123",
			streamUrl: options.noStream ? null : "http://127.0.0.1:50123/stream.mjpeg",
			frame: async () => {
				alive();
				return { bytes: SIM_FRAME, mime: "image/png", hash: "c0ffee" };
			},
			tap: async (x, y, holdMs) => {
				alive();
				input.push(["tap", x, y, holdMs]);
			},
			swipe: async (from, to, durationMs) => {
				alive();
				input.push(["swipe", from, to, durationMs]);
			},
			key: async (key) => {
				alive();
				input.push(["key", key]);
			},
			stop: async () => {
				if (stopped) return;
				stopped = true;
				running -= 1;
			},
		};
		return sim;
	};
	return {
		spawn,
		spawned,
		running: () => running,
		input,
		crash: () => {
			crashed = true;
		},
		refuseNext: () => {
			refuse = true;
		},
	};
}

async function open(sims?: FakeSims) {
	return createIosDirectSession(
		{ platform: "ios", deviceId: UDID, appCaps: [], caseCaps: [] },
		{
			idb: fakeIdb(),
			screenshotFallback: async () => {
				throw new Error("simctl is not faked");
			},
			...(sims ? { yoqaSim: sims.spawn } : {}),
		},
	);
}

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

describe("iOS-simulator Direct lane: device-sim", () => {
	test("spawns one yoqa-sim at connect and serves frames from it", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		expect(sims.spawned).toEqual([UDID]);

		const frames = await Promise.all([session.captureFrame(), session.captureFrame()]);

		expect(frames.map((frame) => frame.base64)).toEqual([base64(SIM_FRAME), base64(SIM_FRAME)]);
		expect(sims.spawned).toEqual([UDID]);
		await session.quit();
	});

	test("quit kills it", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		await session.tap(500, 500);
		expect(sims.running()).toBe(1);

		await session.quit();
		await session.quit();
		expect(sims.running()).toBe(0);
		expect(session.stream).toBeNull();
	});

	test("reports yoqa-sim's MJPEG feed as the session's live stream", async () => {
		const session = await open(fakeSims());
		expect(session.stream).toEqual({
			ready: true,
			port: 50123,
			upstreamUrl: "http://127.0.0.1:50123/stream.mjpeg",
		});
		await session.quit();
	});

	test("a yoqa-sim that printed no stream_ready reports no stream, and still serves frames", async () => {
		const session = await open(fakeSims({ noStream: true }));
		expect(session.stream).toBeNull();
		expect((await session.captureFrame()).base64).toBe(base64(SIM_FRAME));
		await session.quit();
	});

	test("a yoqa-sim that dies mid-session takes its stream with it", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		sims.crash();
		await session.captureFrame();
		expect(session.stream).toBeNull();
	});

	test("when yoqa-sim can't start, frames come from idb_companion and the session says so", async () => {
		const sims = fakeSims({ failSpawn: true });
		const session = await open(sims);

		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect(sims.spawned).toEqual([UDID]);
		expect(session.laneWarning).toMatch(/yoqa-sim failed.*api_ready/);
		expect(session.stream).toBeNull();
	});

	test("without device-sim, nothing is spawned and there is no stream", async () => {
		const session = await open();
		expect(session.stream).toBeNull();
		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		await session.quit();
	});

	test("a yoqa-sim that dies mid-session is stopped, and frames come from idb_companion", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		expect((await session.captureFrame()).base64).toBe(base64(SIM_FRAME));
		sims.crash();

		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect(sims.running()).toBe(0);
		expect(sims.spawned).toHaveLength(1);
		expect(session.laneWarning).toMatch(/yoqa-sim failed.*Connection refused/);
	});

	test("frames carry yoqa-sim's frame hash", async () => {
		const session = await open(fakeSims());
		expect(await session.captureFrame()).toEqual({
			base64: base64(SIM_FRAME),
			mime: "image/png",
			hash: "c0ffee",
		});
		await session.quit();
	});

	test("taps, swipes and drags go to yoqa-sim in 0.0–1.0, not to idb_companion", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		await session.tap(500, 250);
		await session.tap(1000, 0, { durationMs: 600, coordSpace: "screenshot" });
		await session.swipe(500, 900, 500, 100, 300);
		await session.drag(100, 100, 900, 900, 800);

		expect(sims.input).toEqual([
			["tap", 0.5, 0.25, undefined],
			["tap", 1, 0, 600],
			["swipe", { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.1 }, 300],
			["swipe", { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, 800],
		]);
		expect(idbInput).toEqual([]);
		await session.quit();
	});

	test("backgrounding the app presses home on yoqa-sim, then relaunches with idb_companion", async () => {
		const sims = fakeSims();
		const session = await createIosDirectSession(
			{ platform: "ios", deviceId: UDID, appCaps: [], caseCaps: [], bundleId: "com.demo" },
			{ idb: fakeIdb(), yoqaSim: sims.spawn },
		);
		await session.backgroundApp(0);
		expect(sims.input).toEqual([["key", "home"]]);
		expect(idbInput).toEqual([["launch", "com.demo", "--udid", UDID]]);
		await session.quit();
	});

	test("when yoqa-sim can't start, taps go to idb_companion", async () => {
		const session = await open(fakeSims({ failSpawn: true }));
		await session.tap(500, 500);
		expect(idbInput).toEqual([["ui", "tap", "201", "437"]]);
		expect(session.laneWarning).toMatch(/yoqa-sim failed/);
	});

	test("a tap that fails on yoqa-sim mid-session is sent with idb_companion instead", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		await session.tap(500, 500);
		sims.crash();
		await session.tap(500, 500);
		await session.tap(500, 500);

		expect(sims.input).toEqual([["tap", 0.5, 0.5, undefined]]);
		expect(idbInput).toEqual([
			["ui", "tap", "201", "437"],
			["ui", "tap", "201", "437"],
		]);
		expect(sims.running()).toBe(0);
		expect(session.laneWarning).toMatch(/yoqa-sim failed.*Connection refused/);
	});

	test("a gesture yoqa-sim refuses fails the action and is never sent again with idb_companion", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		await session.tap(500, 500);
		sims.refuseNext();

		await expect(session.tap(100, 100)).rejects.toThrow(/did not take the touch/);
		await session.tap(900, 900);

		expect(idbInput).toEqual([]);
		expect(sims.input).toEqual([
			["tap", 0.5, 0.5, undefined],
			["tap", 0.9, 0.9, undefined],
		]);
		expect(session.laneWarning).toBeUndefined();
		await session.quit();
	});
});

/**
 * A faked `yoqa-ax` starter. `never` stands for a helper that doesn't connect: its start
 * rejects after `connectMs`, as `startYoqaAx` does at its 10 s timeout.
 */
function fakeAx(options: { never?: boolean; connectMs?: number } = {}) {
	const started: string[] = [];
	let running = 0;
	const start: StartYoqaAx = async (udid) => {
		started.push(udid);
		await Bun.sleep(options.connectMs ?? 5);
		if (options.never) {
			throw new Error(`yoqa-ax did not connect within ${options.connectMs ?? 5} ms`);
		}
		running += 1;
		let stopped = false;
		const ax: YoqaAx = {
			ping: async () => "ok",
			stop: async () => {
				if (stopped) return;
				stopped = true;
				running -= 1;
			},
		};
		return ax;
	};
	return { start, started, running: () => running };
}

describe("iOS-simulator Direct lane: device-sim with yoqa-ax", () => {
	async function openWithAx(ax: ReturnType<typeof fakeAx>, onLaneWarning?: (w: string) => void) {
		return createIosDirectSession(
			{ platform: "ios", deviceId: UDID, appCaps: [], caseCaps: [], onLaneWarning },
			{ idb: fakeIdb(), yoqaSim: fakeSims().spawn, yoqaAx: ax.start },
		);
	}

	test("starts one yoqa-ax on first use, and quit stops it", async () => {
		const ax = fakeAx();
		const session = await openWithAx(ax);
		expect(ax.started).toEqual([]);

		await Promise.all([session.captureFrame(), session.tap(500, 500)]);
		await Bun.sleep(20);
		expect(ax.started).toEqual([UDID]);
		expect(ax.running()).toBe(1);

		await session.quit();
		await session.quit();
		expect(ax.running()).toBe(0);
		expect(session.laneWarning).toBeUndefined();
	});

	test("quit while yoqa-ax is still connecting stops it once it is up", async () => {
		const ax = fakeAx({ connectMs: 30 });
		const session = await openWithAx(ax);
		await session.captureFrame();
		await session.quit();
		await Bun.sleep(50);
		expect(ax.running()).toBe(0);
	});

	test("a tap never waits for yoqa-ax to connect", async () => {
		const ax = fakeAx({ connectMs: 2_000 });
		const session = await openWithAx(ax);
		const started = performance.now();
		await session.tap(500, 500);
		expect(performance.now() - started).toBeLessThan(500);
		await session.quit();
	});

	test("a yoqa-ax that never connects leaves the session usable and marked degraded", async () => {
		const ax = fakeAx({ never: true, connectMs: 40 });
		const warnings: string[] = [];
		const session = await openWithAx(ax, (warning) => warnings.push(warning));

		await session.tap(500, 500);
		expect(session.laneWarning).toBeUndefined();
		await Bun.sleep(60);

		expect(session.laneWarning).toMatch(/degraded.*yoqa-ax did not connect within 40 ms/);
		expect(warnings).toEqual([session.laneWarning ?? ""]);
		expect((await session.captureFrame()).base64).toBe(base64(SIM_FRAME));
		await session.tap(100, 100);
		expect(JSON.parse(await session.pageSource())).toBeDefined();
		expect(ax.started).toEqual([UDID]);
		await session.quit();
	});
});
