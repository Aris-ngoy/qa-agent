import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
import type { SpawnYoqaSim, YoqaSim } from "./yoqa-sim";

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

function fakeIdb(): IdbExec {
	return async (args) => {
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
	/** The running yoqa-sim crashes: its screenshots fail from now on. */
	crash: () => void;
};

function fakeSims(options: { failSpawn?: boolean } = {}): FakeSims {
	const spawned: string[] = [];
	let running = 0;
	let crashed = false;
	const spawn: SpawnYoqaSim = async (udid) => {
		spawned.push(udid);
		await Bun.sleep(5);
		if (options.failSpawn) throw new Error("yoqa-sim exited before api_ready");
		running += 1;
		let stopped = false;
		const sim: YoqaSim = {
			url: "http://127.0.0.1:50123",
			screenshot: async () => {
				if (crashed) throw new Error("fetch failed: Connection refused");
				return SIM_FRAME;
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
		crash: () => {
			crashed = true;
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
});
