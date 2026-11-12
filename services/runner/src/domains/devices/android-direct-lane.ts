import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { KEY_NAMES } from "@yoqa/runner-client";
import { ensureAndroidSdkEnv } from "../android-toolchain/android-sdk";
import {
	adbKeyArgs,
	encodeAdbInputText,
	findDumpNodeBounds,
	parseWmSize,
	stripUiautomatorDump,
} from "./adb-input";
import {
	ANDROID_ACCEPT_BUTTON_LABELS,
	ANDROID_ACCEPT_RESOURCE_IDS,
	ANDROID_DISMISS_BUTTON_LABELS,
	ANDROID_DISMISS_RESOURCE_IDS,
} from "./android-alerts";
import {
	type AndroidDevtools,
	DEVTOOLS_PACKAGE,
	type StartAndroidDevtools,
	devtoolsTreeToDump,
} from "./android-devtools";
import { type PointerSize, pngSizeFromBase64, toPx } from "./android-gestures";
import { resolveAndroidIdentity } from "./application";
import { composeDeviceSession } from "./device-session";
import { type ToolExec, type ToolResult, requireOk, spawnTool, toolFailure } from "./device-tool";
import { createFrameLoop } from "./frame-loop";
import {
	type DeviceSession,
	type KeySupport,
	type ScreenRecording,
	type SessionOptions,
	guardToolLoss,
	reportLaneFallback,
} from "./lane";
import { remember } from "./once";
import { RECORDER_FINALIZE_MS, exitsWithin, spawnRecorder } from "./recorder-process";

export type AdbResult = ToolResult;

export type AdbExec = ToolExec<AdbResult>;

/** `screenrecord` refuses to run longer than this per file. */
const SCREENRECORD_LIMIT_SECONDS = 180;
async function readRemotePid(stdout: ReadableStream<Uint8Array>): Promise<string> {
	const { value } = await stdout.getReader().read();
	const pid = new TextDecoder().decode(value).trim().split(/\s+/)[0] ?? "";
	if (!/^\d+$/.test(pid))
		throw new Error(`screenrecord: could not read its pid (${pid || "empty"})`);
	return pid;
}

/** Every key maps to a keyevent; modifiers are held with `input keycombination`. */
const ANDROID_KEY_SUPPORT: KeySupport = { keys: KEY_NAMES, modifiers: true };

/** adb could not run, or says the device is no longer attached. */
const ADB_LOST_RE =
	/device '.*' not found|device offline|device not found|no devices\/emulators found/i;

export function adbLostDevice(result: AdbResult): boolean {
	return result.exitCode === 127 || (result.exitCode !== 0 && ADB_LOST_RE.test(result.stderr));
}

export type AndroidDirectDeps = {
	adb?: AdbExec;
	/** adb binary for the long-lived `screenrecord` process; defaults to the resolved adb. */
	adbBin?: string;
	resolveSerial?: (deviceId: string) => Promise<string>;
	/**
	 * Serve capture-frame from a background `screencap` loop (the `device-android`
	 * implementation). A read after input waits for a frame captured after that input.
	 */
	backgroundCapture?: { idleMs?: number };
	/**
	 * Read the tree from the instrumentation helper (`yoqa.android.devtools`) instead of
	 * `uiautomator dump`. When it can't start, the session keeps `uiautomator dump` and
	 * says so in its Lane warning.
	 */
	devtools?: StartAndroidDevtools;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createAdbExec(adbBin: string): AdbExec {
	return (args) => spawnTool([adbBin, ...args]);
}

function resolveAdbBin(): string {
	ensureAndroidSdkEnv();
	const fromPath = Bun.which("adb");
	if (fromPath) return fromPath;
	throw new Error("adb not found — install platform-tools or set ANDROID_HOME");
}

async function defaultResolveSerial(deviceId: string): Promise<string> {
	const identity = await resolveAndroidIdentity(deviceId);
	if (!identity.udid) {
		throw new Error(`Android device ${deviceId} is not connected`);
	}
	return identity.udid;
}

/**
 * Android Device Session over adb. iOS is rejected, so a wrong platform fails the connect.
 */
export async function createAndroidDirectSession(
	options: SessionOptions,
	deps: AndroidDirectDeps = {},
): Promise<DeviceSession> {
	if (options.platform !== "android") {
		throw new Error("Direct lane supports Android only");
	}

	const connectAdb = deps.adb ?? createAdbExec(resolveAdbBin());
	const serial = await (deps.resolveSerial ?? defaultResolveSerial)(options.deviceId);
	const state = await requireOk(await connectAdb(["-s", serial, "get-state"]), "adb get-state");
	if (state.stdout.trim() !== "device") {
		throw new Error(`Android device ${serial} is ${state.stdout.trim() || "unavailable"}`);
	}
	const adb = guardToolLoss(connectAdb, adbLostDevice, options.onSessionDead);

	const fetchWindow = async (): Promise<PointerSize> => {
		const result = await requireOk(await adb(["-s", serial, "shell", "wm", "size"]), "wm size");
		const size = parseWmSize(result.stdout);
		if (!size) throw new Error(`Could not read wm size: ${result.stdout.trim()}`);
		return size;
	};
	const getWindowSize = remember(fetchWindow);

	let lastShotSize: PointerSize | null = null;
	let lastAppId = options.appPackage;

	const grabFrame = async () => {
		const result = await requireOk(
			await adb(["-s", serial, "exec-out", "screencap", "-p"]),
			"screencap",
		);
		const bytes = result.stdoutBytes ?? Buffer.from(result.stdout);
		if (bytes.byteLength === 0) throw new Error("screencap returned an empty frame");
		const base64 = Buffer.from(bytes).toString("base64");
		lastShotSize = pngSizeFromBase64(base64) ?? lastShotSize;
		return { base64, mime: "image/png" as const };
	};

	const frameLoop = deps.backgroundCapture
		? createFrameLoop(grabFrame, { idleMs: deps.backgroundCapture.idleMs })
		: null;

	/** When the last command that can change the screen finished (`performance.now()`). */
	let lastInputAt = 0;
	const readShell = async (args: string[], label: string) =>
		requireOk(await adb(["-s", serial, "shell", ...args]), label);
	const shell = async (args: string[], label: string) => {
		try {
			return await readShell(args, label);
		} finally {
			lastInputAt = performance.now();
			frameLoop?.kick();
		}
	};

	const captureFrame = frameLoop ? () => frameLoop.read(lastInputAt) : grabFrame;

	let devtools: AndroidDevtools | null = null;
	let laneWarning: string | undefined;
	if (deps.devtools) {
		try {
			devtools = await deps.devtools({
				serial,
				adb,
				spawnAdb: (args) =>
					Bun.spawn([deps.adbBin ?? resolveAdbBin(), ...args], {
						stdout: "ignore",
						stderr: "ignore",
					}),
			});
		} catch (error) {
			laneWarning = `Android helper unavailable; reading the tree with uiautomator dump (${errorMessage(error)})`;
		}
	} else {
		// A helper a crashed runner left running holds UiAutomation, so uiautomator dump would fail.
		await adb(["-s", serial, "shell", "am", "force-stop", DEVTOOLS_PACKAGE]);
	}
	const stopDevtools = async () => {
		const running = devtools;
		devtools = null;
		await running?.stop().catch(() => undefined);
	};

	const dumpPageSource = async () => {
		await readShell(["uiautomator", "dump", "/sdcard/yoqa-window.xml"], "uiautomator dump");
		const result = await readShell(["cat", "/sdcard/yoqa-window.xml"], "cat window dump");
		const xml = stripUiautomatorDump(result.stdout);
		if (!xml.includes("<")) {
			throw new Error("uiautomator dump returned no tree");
		}
		return xml;
	};

	const pageSource = async () => {
		if (devtools) {
			try {
				return devtoolsTreeToDump(await devtools.tree(), await getWindowSize());
			} catch (error) {
				// The helper holds the device's UiAutomation, so stop it before uiautomator dump runs.
				reportLaneFallback(
					session,
					options,
					`Android helper failed; reading the tree with uiautomator dump for the rest of the session (${errorMessage(error)})`,
				);
				await stopDevtools();
			}
		}
		return dumpPageSource();
	};

	const pointerSize = async (coordSpace?: "window" | "screenshot"): Promise<PointerSize> => {
		const window = await getWindowSize();
		if (coordSpace === "screenshot") {
			// Any frame gives the size, so this never waits for one captured after the last input.
			if (!lastShotSize) await (frameLoop ? frameLoop.read() : grabFrame());
			return lastShotSize ?? window;
		}
		return window;
	};

	const tapPx = async (x: number, y: number, durationMs: number) => {
		if (durationMs > 80) {
			await shell(
				["input", "swipe", String(x), String(y), String(x), String(y), String(durationMs)],
				"input swipe",
			);
			return;
		}
		await shell(["input", "tap", String(x), String(y)], "input tap");
	};

	const tap: DeviceSession["tap"] = async (xNorm, yNorm, tapOptions) => {
		const size = await pointerSize(tapOptions?.coordSpace);
		await tapPx(toPx(xNorm, size.width), toPx(yNorm, size.height), tapOptions?.durationMs ?? 50);
	};

	const swipe = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs = 400,
		swipeOptions?: { coordSpace?: "window" | "screenshot" },
	) => {
		const size = await pointerSize(swipeOptions?.coordSpace);
		await shell(
			[
				"input",
				"swipe",
				String(toPx(x1, size.width)),
				String(toPx(y1, size.height)),
				String(toPx(x2, size.width)),
				String(toPx(y2, size.height)),
				String(Math.max(50, durationMs)),
			],
			"input swipe",
		);
	};

	const type = async (text: string) => {
		const lines = text.split(/\r?\n/);
		for (const [i, line] of lines.entries()) {
			if (line.length > 0) {
				await shell(["input", "text", encodeAdbInputText(line)], "input text");
			}
			if (i < lines.length - 1) {
				await shell(["input", "keyevent", "66"], "input keyevent");
			}
		}
	};

	const launch = (appId: string, label: string) =>
		shell(["monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"], label);

	const backgroundApp = async (seconds = 3) => {
		await shell(["input", "keyevent", "3"], "KEYCODE_HOME");
		await Bun.sleep(Math.max(0, seconds) * 1000);
		if (lastAppId) await launch(lastAppId, "monkey resume");
	};

	const resolveAlert = async (action: "accept" | "dismiss") => {
		const xml = await pageSource();
		const ids = action === "accept" ? ANDROID_ACCEPT_RESOURCE_IDS : ANDROID_DISMISS_RESOURCE_IDS;
		const labels =
			action === "accept" ? ANDROID_ACCEPT_BUTTON_LABELS : ANDROID_DISMISS_BUTTON_LABELS;
		const bounds =
			ids
				.map((id) => findDumpNodeBounds(xml, (attrs) => attrs["resource-id"] === id))
				.find(Boolean) ??
			labels
				.map((label) =>
					findDumpNodeBounds(
						xml,
						(attrs) => attrs.text === label || attrs["content-desc"] === label,
					),
				)
				.find(Boolean);
		if (!bounds) {
			throw new Error(`No ${action} alert button in the uiautomator dump`);
		}
		await tapPx(
			Math.round(bounds.x + bounds.width / 2),
			Math.round(bounds.y + bounds.height / 2),
			50,
		);
	};

	/** `screenrecord` caps one file at 3 minutes, so a longer Run keeps only that first stretch. */
	const startRecording = async (path: string): Promise<ScreenRecording> => {
		const remote = `/sdcard/yoqa-rec-${Date.now()}.mp4`;
		await mkdir(dirname(path), { recursive: true });
		// Print the shell's pid, then exec screenrecord in its place, so stop can signal this
		// recording alone and not another `screenrecord` running on the device.
		const proc = await spawnRecorder(
			[
				deps.adbBin ?? resolveAdbBin(),
				"-s",
				serial,
				"shell",
				`echo $$; exec screenrecord --time-limit ${SCREENRECORD_LIMIT_SECONDS} ${remote}`,
			],
			"screenrecord",
			"pipe",
		);
		if (!proc.stdout) throw new Error("screenrecord: no output to read its pid from");
		const pid = await readRemotePid(proc.stdout);
		return {
			stop: async () => {
				// SIGINT lets screenrecord write the mp4 trailer; killing the adb client alone would not.
				await adb(["-s", serial, "shell", "kill", "-2", pid]);
				const finalized = await exitsWithin(proc, RECORDER_FINALIZE_MS);
				if (!finalized) proc.kill();
				const pulled = finalized ? await adb(["-s", serial, "pull", remote, path]) : null;
				await adb(["-s", serial, "shell", "rm", "-f", remote]);
				if (!pulled) throw new Error("screenrecord did not finish writing the video");
				if (pulled.exitCode !== 0) throw toolFailure(pulled, "adb pull recording");
			},
		};
	};

	const session = composeDeviceSession({
		stream: null,
		...(laneWarning ? { laneWarning } : {}),
		capabilities: { keys: ANDROID_KEY_SUPPORT, targetApp: true, unsupported: {} },
		where: "on Android",
		quit: async () => {
			await frameLoop?.stop();
			await stopDevtools();
		},
		startRecording,
		captureFrame,
		pageSource,
		getWindowSize,
		tap,
		swipe,
		drag: (x1, y1, x2, y2, durationMs = 800) => swipe(x1, y1, x2, y2, durationMs),
		type,
		key: async (name, modifiers = []) => {
			await shell(adbKeyArgs(name, modifiers), "input key");
		},
		activateApp: async (appId) => {
			lastAppId = appId;
			await launch(appId, "monkey launch");
		},
		setTargetApp: (appId) => {
			lastAppId = appId;
		},
		targetApp: () => lastAppId,
		terminateApp: async (appId) => {
			await shell(["am", "force-stop", appId], "am force-stop");
		},
		backgroundApp,
		openUrl: async (url) => {
			await shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url], "am start VIEW");
		},
		acceptAlert: () => resolveAlert("accept"),
		dismissAlert: () => resolveAlert("dismiss"),
		// The Inspector's pointer is in screenshot pixels; a press and release on one pixel is a tap.
		pointer: {
			kind: "gesture",
			at: async (xNorm, yNorm) => {
				const size = await pointerSize("screenshot");
				return { x: toPx(xNorm, size.width), y: toPx(yNorm, size.height) };
			},
			tap: (point) => tapPx(point.x, point.y, 50),
			swipe: async (from, to) => {
				await shell(
					["input", "swipe", String(from.x), String(from.y), String(to.x), String(to.y), "200"],
					"input swipe",
				);
			},
		},
	});
	return session;
}
