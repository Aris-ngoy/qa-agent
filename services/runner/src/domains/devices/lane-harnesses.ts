/**
 * Lane harnesses for the Lane contract suite (`lane-contract.test.ts`). Each one opens
 * a real Lane with its device tool faked, and reads back what reached the device.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	KEY_MODIFIERS,
	type KeyModifier,
	type KeyName,
	VIEWPORT_PRESETS,
	type ViewportPreset,
	type ViewportPresetName,
} from "@yoqa/runner-client";
import { encodeRgbaPng } from "../runs/coord-grid";
import { ANDROID_KEYCODES, ANDROID_MODIFIER_KEYCODES } from "./adb-input";
import type { AdbExec, AdbResult, AndroidDirectDeps } from "./android-direct-lane";
import { createAndroidDirectSession } from "./android-direct-lane";
import { type FakeCdp, type FakeCdpOptions, fakeChromium, startFakeCdp } from "./fake-cdp";
import { createIosDeviceSession } from "./ios-device-lane";
import type { IdbExec, IdbResult } from "./ios-direct-lane";
import { IOS_HID_KEYCODES, createIosDirectSession } from "./ios-direct-lane";
import type { DeviceSession } from "./lane";
import { CDP_KEYS, CDP_MODIFIERS, createWebDirectSession, webDirectDeps } from "./web-direct-lane";
import type { StartYoqaAx } from "./yoqa-ax";
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
	/** Keys that reached the device, named the way the `key` Action names them. */
	keys: () => Array<{ key: KeyName; modifiers: KeyModifier[] }>;
	/** The frame this harness serves after `taps` taps, base64-encoded. */
	frame: (taps: number) => string;
	/** The device tool dies: every later call fails the way that tool reports it. */
	killTool: () => void;
};

/**
 * Screenshot pixels per device unit. An iOS screenshot is in pixels, 3× the points idb
 * and yoqa-sim take on an iPhone 17 Pro. Android's screencap is in the pixels adb takes.
 */
const IOS_SCREENSHOT_SCALE = 3;

/**
 * The device's screen after `taps` taps, at `scale` screenshot pixels per device unit.
 * Each tap darkens it, so a frame shows what it followed.
 */
function devicePng(taps = 0, scale = 1): Uint8Array {
	const width = DEVICE.width * scale;
	const height = DEVICE.height * scale;
	const rgba = new Uint8Array(width * height * 4).fill(Math.max(0, 255 - taps));
	return new Uint8Array(encodeRgbaPng({ width, height, rgba }));
}

function frameAfterTaps(taps: number, scale = 1): string {
	return Buffer.from(devicePng(taps, scale)).toString("base64");
}

type PressedKey = { key: KeyName; modifiers: KeyModifier[] };

/** The name a device code stands for in `table`, which a harness reads back from its tool. */
function nameOf<T extends string>(table: Record<T, number>, code: number): T {
	const name = (Object.keys(table) as T[]).find((entry) => table[entry] === code);
	if (!name) throw new Error(`no name for device key code ${code}`);
	return name;
}

/** Modifiers in the `key` Action's order, so harnesses compare the same list. */
function inModifierOrder(modifiers: KeyModifier[]): KeyModifier[] {
	return KEY_MODIFIERS.filter((modifier) => modifiers.includes(modifier));
}

const ANDROID_DUMP = `<?xml version="1.0"?><hierarchy><node class="android.widget.Button" text="${BUTTON.label}" clickable="true" enabled="true" bounds="[0,0][100,40]" /></hierarchy>`;

function androidLane(name: string, deps: Partial<AndroidDirectDeps> = {}): LaneHarness {
	const taps: Array<{ x: number; y: number }> = [];
	const keys: PressedKey[] = [];
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
		const press = args.findIndex((arg) => arg === "keyevent" || arg === "keycombination");
		if (args.includes("input") && press >= 0) {
			const codes = args.slice(press + 1).map(Number);
			const code = codes.pop() ?? -1;
			keys.push({
				key: nameOf(ANDROID_KEYCODES, code),
				modifiers: inModifierOrder(codes.map((held) => nameOf(ANDROID_MODIFIER_KEYCODES, held))),
			});
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
					onSessionDead,
				},
				{ adb, resolveSerial: async () => "emulator-5554", ...deps },
			),
		taps: () => taps,
		keys: () => keys,
		frame: (count) => frameAfterTaps(count),
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
	return iosLane("iOS simulator Direct: device-sim (faked idb_companion and yoqa-sim)", {
		yoqaSim: true,
	});
}

/** `device-sim` with `yoqa-ax` faked: the tree comes from it, never from idb_companion. */
export function iosYoqaAxLane(): LaneHarness {
	return iosLane(
		"iOS simulator Direct: device-sim with yoqa-ax (faked idb_companion, yoqa-sim and yoqa-ax)",
		{ yoqaSim: true, yoqaAx: true },
	);
}

function iosLane(name: string, fakes: { yoqaSim?: boolean; yoqaAx?: boolean } = {}): LaneHarness {
	const udid = "B75001FB-B91D-4F94-80A7-3E371A641D27";
	const taps: Array<{ x: number; y: number }> = [];
	const keys: PressedKey[] = [];
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
		if (args[0] === "screenshot") return ok("", devicePng(taps.length, IOS_SCREENSHOT_SCALE));
		if (args[0] === "ui" && args[1] === "describe-all") {
			if (fakes.yoqaAx) return { stdout: "", stderr: "describe-all not faked", exitCode: 1 };
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
		if (args[0] === "ui" && args[1] === "key") {
			keys.push({ key: nameOf(IOS_HID_KEYCODES, Number(args[2])), modifiers: [] });
		}
		return ok();
	};
	const alive = () => {
		if (dead) throw new YoqaSimUnreachableError("fetch failed: Connection refused");
	};
	const yoqaSim: SpawnYoqaSim = async () => ({
		url: "http://127.0.0.1:50123",
		streamUrl: "http://127.0.0.1:50123/stream.mjpeg",
		frame: async () => {
			alive();
			return {
				bytes: devicePng(taps.length, IOS_SCREENSHOT_SCALE),
				mime: "image/png",
				hash: `taps-${taps.length}`,
			};
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
	const yoqaAx: StartYoqaAx = async () => ({
		ping: async () => "ok",
		describe: async () => ({
			nodes: [
				{
					role: "Button",
					label: BUTTON.label,
					frame: {
						x: BUTTON.x / 1000,
						y: BUTTON.y / 1000,
						width: BUTTON.width / 1000,
						height: BUTTON.height / 1000,
					},
					enabled: true,
				},
			],
			degraded: false,
		}),
		alert: async () => ({ buttons: [] }),
		stop: async () => undefined,
	});
	return {
		name,
		open: ({ onSessionDead }) =>
			createIosDirectSession(
				{ platform: "ios", deviceId: udid, onSessionDead },
				{
					idb,
					screenshotFallback: async () => {
						throw new Error("simctl is not faked");
					},
					...(fakes.yoqaSim ? { yoqaSim } : {}),
					...(fakes.yoqaAx ? { yoqaAx } : {}),
				},
			),
		taps: () => taps,
		keys: () => keys,
		frame: (count) => frameAfterTaps(count, IOS_SCREENSHOT_SCALE),
		killTool: () => {
			dead = true;
		},
	};
}

/**
 * `device-ios`: `YoqaRunner` on a cabled phone, faked as an HTTP server that answers its
 * wire protocol. It takes 0.0–1.0 fractions, so taps are recorded in the device points they
 * land on, and its screenshot is in pixels, 3× the points.
 */
export function iosDeviceLane(): LaneHarness {
	const taps: Array<{ x: number; y: number }> = [];
	const keys: PressedKey[] = [];
	const ok = (data: unknown) =>
		Response.json({ ok: true, data }, { headers: { Connection: "close" } });
	const runner = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json()) as {
				command: string;
				x?: number;
				y?: number;
				text?: string;
			};
			switch (body.command) {
				case "viewport":
					return ok({ ...DEVICE });
				case "screenshot":
					return ok({ png: frameAfterTaps(taps.length, IOS_SCREENSHOT_SCALE) });
				case "snapshot":
					return ok({
						nodes: [
							{
								role: "Button",
								label: BUTTON.label,
								frame: {
									x: BUTTON.x / 1000,
									y: BUTTON.y / 1000,
									width: BUTTON.width / 1000,
									height: BUTTON.height / 1000,
								},
								enabled: true,
							},
						],
					});
				case "tap":
					taps.push({ x: (body.x ?? -1) * DEVICE.width, y: (body.y ?? -1) * DEVICE.height });
					return ok({});
				case "keyboardReturn":
					keys.push({ key: "Enter", modifiers: [] });
					return ok({});
				case "keyboardDelete":
					keys.push({ key: "Backspace", modifiers: [] });
					return ok({});
				case "type":
					if (body.text === " ") keys.push({ key: "Space", modifiers: [] });
					return ok({});
				default:
					return ok({ state: "ready" });
			}
		},
	});
	runner.unref();
	// A dead tool on this Lane is the YoqaRunner process exiting, not a cable miss on a frame.
	let reportExit: (code: number) => void = () => undefined;
	const exited = new Promise<number>((resolve) => {
		reportExit = resolve;
	});
	return {
		name: "Physical iOS Direct: device-ios (faked YoqaRunner)",
		open: ({ onSessionDead }) =>
			createIosDeviceSession(
				{
					platform: "ios",
					deviceId: "00008120-000E6D813E2A601E",
					onSessionDead,
				},
				{
					startRunner: async () => ({
						port: 49_733,
						exited,
						stop: async () => undefined,
					}),
					connect: async () => createConnection(runner.port ?? 0, "127.0.0.1"),
					devicectl: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
				},
			),
		taps: () => taps,
		keys: () => keys,
		frame: (count) => frameAfterTaps(count, IOS_SCREENSHOT_SCALE),
		killTool: () => {
			runner.stop(true);
			reportExit(1);
		},
	};
}

/**
 * The faked browser every web harness drives: a window of its own size, which the lane's
 * Viewport preset overrides. The button is laid out where BUTTON is on that preset's page.
 */
function webPage(preset: ViewportPreset): FakeCdpOptions {
	return {
		viewport: { width: 900, height: 700 },
		deviceScaleFactor: 2,
		nodes: [
			{
				role: "button",
				name: BUTTON.label,
				box: {
					x: (BUTTON.x / 1000) * preset.width,
					y: (BUTTON.y / 1000) * preset.height,
					width: (BUTTON.width / 1000) * preset.width,
					height: (BUTTON.height / 1000) * preset.height,
				},
			},
		],
	};
}

/**
 * Where clicks landed on the preset's page, in DEVICE units, so every Lane is read back
 * on the same device: the page is the preset's size, not DEVICE's.
 */
function webTaps(browser: FakeCdp, preset: ViewportPreset): Array<{ x: number; y: number }> {
	return browser.clicks.map(({ x, y }) => ({
		x: (x / preset.width) * DEVICE.width,
		y: (y / preset.height) * DEVICE.height,
	}));
}

/** A key pressed down that is not itself a modifier, with the modifiers its bits hold. */
function cdpKeys(browser: FakeCdp): Array<{ key: KeyName; modifiers: KeyModifier[] }> {
	return browser.keyEvents.flatMap((event) => {
		if (event.type === "keyUp") return [];
		const key = (Object.keys(CDP_KEYS) as KeyName[]).find(
			(name) => CDP_KEYS[name].code === event.code,
		);
		if (!key) return [];
		const modifiers = KEY_MODIFIERS.filter(
			(modifier) => ((event.modifiers ?? 0) & CDP_MODIFIERS[modifier].bit) !== 0,
		);
		return [{ key, modifiers }];
	});
}

/**
 * Web Direct: a user-started Chromium attached by its debug port, faked as a local CDP
 * endpoint, on the desktop preset unless told otherwise. The harness also hands over its
 * fake browser, for the web-only contract cases.
 */
export function webCdpLane(
	options: { viewport?: ViewportPresetName } = {},
): LaneHarness & { browser: FakeCdp } {
	const preset = VIEWPORT_PRESETS[options.viewport ?? "desktop"];
	const browser = startFakeCdp(webPage(preset));
	const name = options.viewport ? ` on the ${options.viewport} preset` : "";
	return {
		name: `Web Direct: an attached Chromium${name} (faked CDP endpoint)`,
		open: ({ onSessionDead }) =>
			createWebDirectSession({
				platform: "web",
				deviceId: `chromium-cdp-${browser.port}`,
				onSessionDead,
				...(options.viewport ? { viewport: options.viewport } : {}),
			}),
		taps: () => webTaps(browser, preset),
		keys: () => cdpKeys(browser),
		frame: (count) => browser.frame(count),
		killTool: () => browser.kill(),
		browser,
	};
}

/** Web Direct under the mobile preset, where taps reach the page as touches. */
export function webMobileLane(): LaneHarness & { browser: FakeCdp } {
	return webCdpLane({ viewport: "mobile" });
}

/**
 * Web Direct: an installed Chrome that the lane launches as a Yoqa-owned instance, with the
 * browser process faked so each launch starts a local CDP endpoint. Its Kept profile is
 * under a temporary home.
 */
export function webLaunchedLane(): LaneHarness {
	const preset = VIEWPORT_PRESETS.desktop;
	const chromium = fakeChromium(webPage(preset));
	const home = mkdtempSync(join(tmpdir(), "yoqa-home-"));
	const browser = () => {
		const launched = chromium.browsers[0];
		if (!launched) throw new Error("The lane has not launched the browser yet");
		return launched;
	};
	return {
		name: "Web Direct: a Yoqa-owned Chrome (faked browser process)",
		open: ({ onSessionDead }) =>
			createWebDirectSession(
				{ platform: "web", deviceId: "web-chrome", onSessionDead },
				webDirectDeps({
					installedBrowsers: async () => [
						{
							id: "web-chrome",
							name: "Google Chrome",
							version: "141.0",
							executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
						},
					],
					spawn: chromium.spawn,
					home,
				}),
			),
		taps: () => webTaps(browser(), preset),
		keys: () => cdpKeys(browser()),
		frame: (count) => browser().frame(count),
		killTool: () => browser().kill(),
	};
}

/**
 * Web Direct: the user's Everyday Chrome, with the remote-debugging toggle on and a tab of
 * the user's own, faked as a CDP endpoint that asks before each socket. The user clicks
 * Allow on every connect; the session drives a page in a window of its own.
 */
export function webEverydayLane(): LaneHarness & { browser: FakeCdp } {
	const preset = VIEWPORT_PRESETS.desktop;
	const browser = startFakeCdp({ ...webPage(preset), consent: true });
	browser.openPage("https://mail.example.com/inbox");
	const userDataDir = mkdtempSync(join(tmpdir(), "yoqa-chrome-"));
	writeFileSync(
		join(userDataDir, "DevToolsActivePort"),
		`${browser.port}\n/devtools/browser/fake\n`,
	);
	return {
		name: "Web Direct: the Everyday Chrome, by consent (faked CDP endpoint)",
		open: ({ onSessionDead }) => {
			browser.allow();
			return createWebDirectSession(
				{ platform: "web", deviceId: "web-chrome-everyday", onSessionDead },
				webDirectDeps({
					everydayBrowsers: async () => [
						{ id: "web-chrome-everyday", name: "Google Chrome", userDataDir },
					],
				}),
			);
		},
		taps: () => webTaps(browser, preset),
		keys: () => cdpKeys(browser),
		frame: (count) => browser.frame(count),
		killTool: () => browser.kill(),
		browser,
	};
}
