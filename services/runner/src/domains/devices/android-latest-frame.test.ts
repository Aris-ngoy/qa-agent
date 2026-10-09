import { describe, expect, test } from "bun:test";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { AdbExec, AdbResult } from "./android-direct-lane";
import { createAndroidDirectSession } from "./android-direct-lane";

function ok(stdout = "", stdoutBytes?: Uint8Array): AdbResult {
	return { stdout, stderr: "", exitCode: 0, stdoutBytes };
}

function png(shade: number): Uint8Array {
	return new Uint8Array(
		encodeRgbaPng({ width: 1, height: 1, rgba: new Uint8Array([shade, 0, 0, 255]) }),
	);
}

/**
 * adb whose `screencap` calls wait until the test releases them, one at a time. Each frame
 * shows the number of taps the device has received so far, as its red channel.
 */
function gatedAdb() {
	let taps = 0;
	let captures = 0;
	const pending: Array<() => void> = [];
	const adb: AdbExec = async (args) => {
		const joined = args.join(" ");
		if (joined.includes("get-state")) return ok("device\n");
		if (joined.includes("wm size")) return ok("Physical size: 1000x2000\n");
		if (joined.includes("screencap")) {
			captures += 1;
			await new Promise<void>((resolve) => pending.push(resolve));
			return ok("", png(taps));
		}
		if (args.includes("input") && args.includes("tap")) taps += 1;
		return ok();
	};
	return {
		adb,
		captures: () => captures,
		/** Let the oldest in-flight screencap finish, then let the loop schedule its next one. */
		release: async () => {
			while (pending.length === 0) await Bun.sleep(1);
			pending.shift()?.();
			await Bun.sleep(5);
		},
		/** Let the most recently started screencap finish, leaving older ones in flight. */
		releaseNewest: async () => {
			pending.pop()?.();
			await Bun.sleep(5);
		},
		inFlight: () => pending.length,
	};
}

function open(adb: AdbExec) {
	return createAndroidDirectSession(
		{ platform: "android", deviceId: "emulator-5554", appCaps: [], caseCaps: [] },
		{ adb, resolveSerial: async () => "emulator-5554", backgroundCapture: { idleMs: 60_000 } },
	);
}

const frameAfterTaps = (taps: number) => Buffer.from(png(taps)).toString("base64");

describe("Android Direct lane with a background capture", () => {
	test("capture-frame returns the latest frame without starting a new adb capture", async () => {
		const device = gatedAdb();
		const session = await open(device.adb);
		const first = session.captureFrame();
		await device.release();
		const frame = await first;
		const startedBefore = device.captures();

		const again = await Promise.all([
			session.captureFrame(),
			session.captureFrame(),
			session.captureFrame(),
		]);

		expect(again.map((f) => f.base64)).toEqual([frame.base64, frame.base64, frame.base64]);
		expect(device.captures()).toBe(startedBefore);
		await session.quit();
	});

	test("a tap never waits for the capture in flight", async () => {
		const device = gatedAdb();
		const session = await open(device.adb);
		const first = session.captureFrame();
		await device.release();
		await first;
		expect(device.inFlight()).toBe(1);

		// The capture in flight is never released; the tap must not wait for it.
		await session.tap(500, 500);
		await session.quit();
	});

	test("after a tap, capture-frame returns a frame captured after it", async () => {
		const device = gatedAdb();
		const session = await open(device.adb);
		const first = session.captureFrame();
		await device.release();
		expect((await first).base64).toBe(frameAfterTaps(0));

		await session.tap(500, 500);
		const afterTap = session.captureFrame();
		// The capture in flight started before the tap, so its frame is not good enough.
		await device.release();
		await device.release();

		expect((await afterTap).base64).toBe(frameAfterTaps(1));
		await session.quit();
	});

	test("a read after a tap waits for one new capture, not the one already in flight", async () => {
		const device = gatedAdb();
		const session = await open(device.adb);
		const first = session.captureFrame();
		await device.release();
		await first;

		await session.tap(500, 500);
		const afterTap = session.captureFrame();
		await device.releaseNewest();

		expect((await afterTap).base64).toBe(frameAfterTaps(1));
		expect(device.inFlight()).toBe(1);
		await session.quit();
	});

	test("the loop stops capturing while nobody reads frames", async () => {
		let captures = 0;
		const adb: AdbExec = async (args) => {
			const joined = args.join(" ");
			if (joined.includes("get-state")) return ok("device\n");
			if (joined.includes("screencap")) {
				captures += 1;
				await Bun.sleep(2);
				return ok("", png(0));
			}
			return ok();
		};
		const session = await createAndroidDirectSession(
			{ platform: "android", deviceId: "emulator-5554", appCaps: [], caseCaps: [] },
			{ adb, resolveSerial: async () => "emulator-5554", backgroundCapture: { idleMs: 20 } },
		);
		await session.captureFrame();
		await Bun.sleep(60);
		const afterIdle = captures;
		await Bun.sleep(60);

		expect(captures).toBe(afterIdle);
		await session.quit();
	});

	test("quit stops the loop and later reads fail as a Dead Session", async () => {
		const device = gatedAdb();
		const session = await open(device.adb);
		const first = session.captureFrame();
		await device.release();
		await first;

		await session.quit();
		await device.release();
		await Bun.sleep(20);

		expect(device.inFlight()).toBe(0);
		await expect(session.captureFrame()).rejects.toThrow(/session ended/i);
	});
});
