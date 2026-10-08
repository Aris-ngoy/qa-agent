import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureAndroidSdkEnv } from "../appium/android-sdk";
import {
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
import { type PointerSize, pngSizeFromBase64, toPx } from "./android-gestures";
import { resolveAndroidAppiumIdentity } from "./application";
import type { DeviceSession, PointerPhase, ScreenRecording, SessionOptions } from "./lane";
import { remember } from "./once";
import { exitsWithin, spawnRecorder } from "./recorder-process";
import { SCREENSHOT_DIR } from "./screenshot-retention";

export type AdbResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	stdoutBytes?: Uint8Array;
};

export type AdbExec = (args: string[]) => Promise<AdbResult>;

/** `screenrecord` refuses to run longer than this per file. */
const SCREENRECORD_LIMIT_SECONDS = 180;
/** Longest wait for screenrecord to write the mp4 trailer after SIGINT. */
const SCREENRECORD_FINALIZE_MS = 10_000;

async function readRemotePid(stdout: ReadableStream<Uint8Array>): Promise<string> {
	const { value } = await stdout.getReader().read();
	const pid = new TextDecoder().decode(value).trim().split(/\s+/)[0] ?? "";
	if (!/^\d+$/.test(pid))
		throw new Error(`screenrecord: could not read its pid (${pid || "empty"})`);
	return pid;
}

export type AndroidDirectDeps = {
	adb?: AdbExec;
	/** adb binary for the long-lived `screenrecord` process; defaults to the resolved adb. */
	adbBin?: string;
	resolveSerial?: (deviceId: string) => Promise<string>;
};

function fail(result: AdbResult, label: string): never {
	throw new Error(
		`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
	);
}

async function requireOk(result: AdbResult, label: string): Promise<AdbResult> {
	if (result.exitCode !== 0) fail(result, label);
	return result;
}

export function createAdbExec(adbBin: string): AdbExec {
	return async (args) => {
		try {
			const proc = Bun.spawn([adbBin, ...args], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdoutBuf, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const stdoutBytes = new Uint8Array(stdoutBuf);
			return {
				stdout: new TextDecoder().decode(stdoutBytes),
				stderr,
				exitCode,
				stdoutBytes,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { stdout: "", stderr: message, exitCode: 127 };
		}
	};
}

function resolveAdbBin(): string {
	ensureAndroidSdkEnv();
	const fromPath = Bun.which("adb");
	if (fromPath) return fromPath;
	throw new Error("adb not found — install platform-tools or set ANDROID_HOME");
}

async function defaultResolveSerial(deviceId: string): Promise<string> {
	const identity = await resolveAndroidAppiumIdentity(deviceId);
	if (!identity.udid) {
		throw new Error(`Android device ${deviceId} is not connected`);
	}
	return identity.udid;
}

function createLock() {
	let chain = Promise.resolve();
	let pointerActive = false;
	return {
		isPointerActive: () => pointerActive,
		setPointerActive: (value: boolean) => {
			pointerActive = value;
		},
		withLock: <T>(fn: () => Promise<T>): Promise<T> => {
			const run = chain.then(fn, fn);
			chain = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
	};
}

/**
 * Android Device Session over adb — no Appium server. iOS is rejected so connect
 * can fall back to the Appium lane (ADR-0004).
 */
export async function createAndroidDirectSession(
	options: SessionOptions,
	deps: AndroidDirectDeps = {},
): Promise<DeviceSession> {
	if (options.platform !== "android") {
		throw new Error("Direct lane supports Android only");
	}

	const adb = deps.adb ?? createAdbExec(resolveAdbBin());
	const serial = await (deps.resolveSerial ?? defaultResolveSerial)(options.deviceId);
	const state = await requireOk(await adb(["-s", serial, "get-state"]), "adb get-state");
	if (state.stdout.trim() !== "device") {
		throw new Error(`Android device ${serial} is ${state.stdout.trim() || "unavailable"}`);
	}

	const fetchWindow = async (): Promise<PointerSize> => {
		const result = await requireOk(await adb(["-s", serial, "shell", "wm", "size"]), "wm size");
		const size = parseWmSize(result.stdout);
		if (!size) throw new Error(`Could not read wm size: ${result.stdout.trim()}`);
		return size;
	};
	const getWindowSize = remember(fetchWindow);

	let lastShotSize: PointerSize | null = null;
	let lastAppId = options.appPackage;
	let pointerStart: { x: number; y: number } | null = null;

	const shell = async (args: string[], label: string) =>
		requireOk(await adb(["-s", serial, "shell", ...args]), label);

	const captureFrame = async () => {
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

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	const pageSource = async () => {
		await shell(["uiautomator", "dump", "/sdcard/yoqa-window.xml"], "uiautomator dump");
		const result = await shell(["cat", "/sdcard/yoqa-window.xml"], "cat window dump");
		const xml = stripUiautomatorDump(result.stdout);
		if (!xml.includes("<")) {
			throw new Error("uiautomator dump returned no tree");
		}
		return xml;
	};

	const pointerSize = async (coordSpace?: "window" | "screenshot"): Promise<PointerSize> => {
		const window = await getWindowSize();
		if (coordSpace === "screenshot") {
			if (!lastShotSize) await captureFrame();
			return lastShotSize ?? window;
		}
		return window;
	};

	const lock = createLock();

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

	const tap = async (
		xNorm: number,
		yNorm: number,
		tapOptions?: { durationMs?: number; coordSpace?: "window" | "screenshot" },
	) => {
		await lock.withLock(async () => {
			const size = await pointerSize(tapOptions?.coordSpace);
			await tapPx(toPx(xNorm, size.width), toPx(yNorm, size.height), tapOptions?.durationMs ?? 50);
		});
	};

	const swipe = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs = 400,
		swipeOptions?: { coordSpace?: "window" | "screenshot" },
	) => {
		await lock.withLock(async () => {
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
		});
	};

	const type = async (text: string) => {
		await lock.withLock(async () => {
			const lines = text.split(/\r?\n/);
			for (const [i, line] of lines.entries()) {
				if (line.length > 0) {
					await shell(["input", "text", encodeAdbInputText(line)], "input text");
				}
				if (i < lines.length - 1) {
					await shell(["input", "keyevent", "66"], "input keyevent");
				}
			}
		});
	};

	const activateApp = async (appId: string) => {
		await lock.withLock(async () => {
			lastAppId = appId;
			await shell(
				["monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"],
				"monkey launch",
			);
		});
	};

	const terminateApp = async (appId: string) => {
		await lock.withLock(async () => {
			await shell(["am", "force-stop", appId], "am force-stop");
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await lock.withLock(async () => {
			await shell(["input", "keyevent", "3"], "KEYCODE_HOME");
			await Bun.sleep(Math.max(0, seconds) * 1000);
			if (lastAppId) {
				await shell(
					["monkey", "-p", lastAppId, "-c", "android.intent.category.LAUNCHER", "1"],
					"monkey resume",
				);
			}
		});
	};

	const openUrl = async (url: string) => {
		await lock.withLock(async () => {
			await shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url], "am start VIEW");
		});
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
				const finalized = await exitsWithin(proc, SCREENRECORD_FINALIZE_MS);
				if (!finalized) proc.kill();
				const pulled = finalized ? await adb(["-s", serial, "pull", remote, path]) : null;
				await adb(["-s", serial, "shell", "rm", "-f", remote]);
				if (!pulled) throw new Error("screenrecord did not finish writing the video");
				if (pulled.exitCode !== 0) fail(pulled, "adb pull recording");
			},
		};
	};

	const session: DeviceSession = {
		lane: "direct",
		stream: null,
		quit: async () => undefined,
		startRecording,
		captureFrame,
		screenshot,
		pageSource,
		getWindowSize,
		tap,
		swipe,
		drag: (x1, y1, x2, y2, durationMs = 800) => swipe(x1, y1, x2, y2, durationMs),
		type,
		activateApp,
		terminateApp,
		backgroundApp,
		openUrl,
		acceptAlert: () => lock.withLock(() => resolveAlert("accept")),
		dismissAlert: () => lock.withLock(() => resolveAlert("dismiss")),
		withActionLock: (fn) => lock.withLock(fn),
		pointerEvent: async (phase: PointerPhase, xNorm: number, yNorm: number) => {
			const size = await pointerSize("screenshot");
			const x = toPx(xNorm, size.width);
			const y = toPx(yNorm, size.height);
			if (phase === "begin") {
				pointerStart = { x, y };
				lock.setPointerActive(true);
				return;
			}
			if (phase === "move") {
				pointerStart = pointerStart ?? { x, y };
				return;
			}
			const start = pointerStart ?? { x, y };
			pointerStart = null;
			lock.setPointerActive(false);
			if (start.x === x && start.y === y) {
				await tapPx(x, y, 50);
			} else {
				await shell(
					["input", "swipe", String(start.x), String(start.y), String(x), String(y), "200"],
					"input swipe",
				);
			}
		},
		isPointerActive: () => lock.isPointerActive(),
	};
	return session;
}
