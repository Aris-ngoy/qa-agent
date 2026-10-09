/**
 * Lane harnesses for the Lane contract suite (`lane-contract.test.ts`). Each one opens
 * a real Lane with its device tool faked, and reads back what reached the device.
 */
import type { Browser } from "webdriverio";
import { encodeRgbaPng } from "../runs/coord-grid";
import type { AdbExec, AdbResult, AndroidDirectDeps } from "./android-direct-lane";
import { createAndroidDirectSession } from "./android-direct-lane";
import { createAppiumSession } from "./appium-lane";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { createIosDirectSession } from "./ios-direct-lane";
import type { DeviceSession } from "./lane";
import { type SpawnYoqaSim, YoqaSimUnreachableError } from "./yoqa-sim";

/** The device every harness fakes, in the unit its tool uses (pixels, or points for idb). */
export const DEVICE = { width: 200, height: 400 };

/**
 * The one control on the faked Screen: a button at (0,0) sized 100×40 device units,
 * which is 500×100 on the 0–1000 scale of a 200×400 device.
 */
export const BUTTON = { label: "Allow", x: 0, y: 0, width: 500, height: 100 };

export type LaneHarness = {
	name: string;
	open: (hooks: { onSessionDead: () => void }) => Promise<DeviceSession>;
	/** Where taps landed, in device units. */
	taps: () => Array<{ x: number; y: number }>;
	/** The device tool dies: every later call fails the way that tool reports it. */
	killTool: () => void;
};

/** The device's screen after `taps` taps: each tap darkens it, so a frame shows what it followed. */
function devicePng(taps = 0): Uint8Array {
	const rgba = new Uint8Array(DEVICE.width * DEVICE.height * 4).fill(Math.max(0, 255 - taps));
	return new Uint8Array(encodeRgbaPng({ width: DEVICE.width, height: DEVICE.height, rgba }));
}

/** The frame a harness serves after `taps` taps, base64-encoded. */
export function frameAfterTaps(taps: number): string {
	return Buffer.from(devicePng(taps)).toString("base64");
}

const ANDROID_DUMP = `<?xml version="1.0"?><hierarchy><node class="android.widget.Button" text="${BUTTON.label}" clickable="true" enabled="true" bounds="[0,0][100,40]" /></hierarchy>`;

export function appiumLane(): LaneHarness {
	const taps: Array<{ x: number; y: number }> = [];
	let dead = false;
	const alive = <T>(value: T): Promise<T> =>
		dead ? Promise.reject(new Error("invalid session id")) : Promise.resolve(value);
	const browser = {
		capabilities: { platformName: "Android" },
		getWindowSize: () => alive({ ...DEVICE }),
		takeScreenshot: () => alive(frameAfterTaps(taps.length)),
		getPageSource: () => alive(ANDROID_DUMP),
		execute: (command: string, params?: { x?: number; y?: number }) => {
			if (!dead && command === "mobile: clickGesture" && params) {
				taps.push({ x: params.x ?? -1, y: params.y ?? -1 });
			}
			return alive(null);
		},
		performActions: () => alive(undefined),
		releaseActions: () => alive(undefined),
		deleteSession: () => alive(undefined),
	} as unknown as Browser;
	return {
		name: "Appium (faked WebDriver)",
		open: ({ onSessionDead }) =>
			createAppiumSession(
				{
					platform: "android",
					deviceId: "emulator-5554",
					appCaps: [],
					caseCaps: [],
					onSessionDead,
				},
				{ connect: async () => ({ browser, mjpegPort: 9100, streamReady: false }) },
			),
		taps: () => taps,
		killTool: () => {
			dead = true;
		},
	};
}

function androidLane(name: string, deps: Partial<AndroidDirectDeps> = {}): LaneHarness {
	const taps: Array<{ x: number; y: number }> = [];
	let dead = false;
	const ok = (stdout = "", stdoutBytes?: Uint8Array): AdbResult => ({
		stdout,
		stderr: "",
		exitCode: 0,
		stdoutBytes,
	});
	const adb: AdbExec = async (args) => {
		if (dead) return { stdout: "", stderr: "error: device 'emulator-5554' not found", exitCode: 1 };
		const joined = args.join(" ");
		if (joined.includes("get-state")) return ok("device\n");
		if (joined.includes("wm size")) return ok(`Physical size: ${DEVICE.width}x${DEVICE.height}\n`);
		if (joined.includes("screencap")) return ok("", devicePng(taps.length));
		if (joined.includes("uiautomator dump")) {
			// With the helper faked, a tree read must come from it, never from a dump.
			if (deps.devtools) return { stdout: "", stderr: "dump not faked", exitCode: 1 };
			return ok("UI hierchary dumped\n");
		}
		if (joined.includes("cat") && joined.includes("yoqa-window.xml")) return ok(ANDROID_DUMP);
		const tap = args.indexOf("tap");
		if (args.includes("input") && tap >= 0) {
			taps.push({ x: Number(args[tap + 1]), y: Number(args[tap + 2]) });
		}
		return ok();
	};
	return {
		name,
		open: ({ onSessionDead }) =>
			createAndroidDirectSession(
				{
					platform: "android",
					deviceId: "emulator-5554",
					appCaps: [],
					caseCaps: [],
					onSessionDead,
				},
				{ adb, resolveSerial: async () => "emulator-5554", ...deps },
			),
		taps: () => taps,
		killTool: () => {
			dead = true;
		},
	};
}

export function androidAdbLane(): LaneHarness {
	return androidLane("Android Direct: adb (faked adb)");
}

export function androidLatestFrameLane(): LaneHarness {
	return androidLane("Android Direct: device-android (faked adb)", { backgroundCapture: {} });
}

/** `device-android` with the instrumentation helper faked: the tree comes from it, not a dump. */
export function androidDevtoolsLane(): LaneHarness {
	return androidLane("Android Direct: device-android with the helper (faked adb and helper)", {
		backgroundCapture: {},
		devtools: async () => ({
			tree: async () => ({
				nodes: [
					{
						role: "android.widget.Button",
						value: BUTTON.label,
						bounds: {
							x: BUTTON.x / 1000,
							y: BUTTON.y / 1000,
							width: BUTTON.width / 1000,
							height: BUTTON.height / 1000,
						},
						enabled: true,
					},
				],
			}),
			stop: async () => undefined,
		}),
	});
}

export function iosIdbLane(): LaneHarness {
	return iosLane("iOS simulator Direct (faked idb_companion)");
}

/** `device-sim`: screenshots from a faked `yoqa-sim` that shows the same device as idb. */
export function iosYoqaSimLane(): LaneHarness {
	return iosLane("iOS simulator Direct: device-sim (faked idb_companion and yoqa-sim)", true);
}

function iosLane(name: string, withYoqaSim = false): LaneHarness {
	const udid = "B75001FB-B91D-4F94-80A7-3E371A641D27";
	const taps: Array<{ x: number; y: number }> = [];
	let dead = false;
	const ok = (stdout = "", stdoutBytes?: Uint8Array): IdbResult => ({
		stdout,
		stderr: "",
		exitCode: 0,
		stdoutBytes,
	});
	const idb: IdbExec = async (args) => {
		if (dead) {
			return {
				stdout: "",
				stderr: "StatusCode.UNAVAILABLE: failed to connect to all addresses; Connection refused",
				exitCode: 1,
			};
		}
		if (args[0] === "describe") {
			return ok(
				JSON.stringify({
					target_type: "simulator",
					screen_dimensions: { width_points: DEVICE.width, height_points: DEVICE.height },
				}),
			);
		}
		if (args[0] === "screenshot") return ok("", devicePng(taps.length));
		if (args[0] === "ui" && args[1] === "describe-all") {
			return ok(
				JSON.stringify({
					elements: [
						{
							type: "Button",
							label: BUTTON.label,
							frame: { x: 0, y: 0, width: 100, height: 40 },
							enabled: true,
						},
					],
				}),
			);
		}
		if (args[0] === "ui" && args[1] === "tap") {
			taps.push({ x: Number(args[2]), y: Number(args[3]) });
		}
		return ok();
	};
	const alive = () => {
		if (dead) throw new YoqaSimUnreachableError("fetch failed: Connection refused");
	};
	const yoqaSim: SpawnYoqaSim = async () => ({
		url: "http://127.0.0.1:50123",
		frame: async () => {
			alive();
			return { bytes: devicePng(taps.length), mime: "image/png", hash: `taps-${taps.length}` };
		},
		// yoqa-sim takes 0.0–1.0; record the device point it lands on, as idb's taps are.
		tap: async (x, y) => {
			alive();
			taps.push({ x: x * DEVICE.width, y: y * DEVICE.height });
		},
		swipe: async () => alive(),
		key: async () => alive(),
		stop: async () => undefined,
	});
	return {
		name,
		open: ({ onSessionDead }) =>
			createIosDirectSession(
				{ platform: "ios", deviceId: udid, appCaps: [], caseCaps: [], onSessionDead },
				{
					idb,
					screenshotFallback: async () => {
						throw new Error("simctl is not faked");
					},
					...(withYoqaSim ? { yoqaSim } : {}),
				},
			),
		taps: () => taps,
		killTool: () => {
			dead = true;
		},
	};
}
