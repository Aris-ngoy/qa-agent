import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
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

function fakeSims(options: { failSpawn?: boolean } = {}): FakeSims {
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
	test("spawns one yoqa-sim on first use and serves frames from it", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		expect(sims.spawned).toEqual([]);

		const frames = await Promise.all([session.captureFrame(), session.captureFrame()]);

		expect(frames.map((frame) => frame.base64)).toEqual([base64(SIM_FRAME), base64(SIM_FRAME)]);
		expect(sims.spawned).toEqual([UDID]);
		await session.quit();
	});

	test("the first action spawns it too, and quit kills it", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		await session.tap(500, 500);
		await Bun.sleep(20);
		expect(sims.spawned).toEqual([UDID]);
		expect(sims.running()).toBe(1);

		await session.quit();
		await session.quit();
		expect(sims.running()).toBe(0);
	});

	test("quit while it is still starting kills it once it is up", async () => {
		const sims = fakeSims();
		const session = await open(sims);
		const frame = session.captureFrame();
		await session.quit();
		await frame.catch(() => undefined);
		expect(sims.running()).toBe(0);
	});

	test("when yoqa-sim can't start, frames come from idb_companion and the session says so", async () => {
		const sims = fakeSims({ failSpawn: true });
		const session = await open(sims);

		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect((await session.captureFrame()).base64).toBe(base64(IDB_FRAME));
		expect(sims.spawned).toEqual([UDID]);
		expect(session.laneWarning).toMatch(/yoqa-sim failed.*api_ready/);
	});

	test("without device-sim, nothing is spawned", async () => {
		const session = await open();
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
