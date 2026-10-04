import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PointerSize, pngSizeFromBase64, toPx } from "./android-gestures";
import { looksLikePhysicalIosUdid } from "./appium-lane";
import { requireIdbBins } from "./idb-companion";
import type { DeviceSession, PointerPhase, SessionOptions } from "./lane";
import { remember } from "./once";
import { cleanPageSource } from "./screen";
import { SCREENSHOT_DIR } from "./screenshot-retention";

const IOS_ACCEPT_LABELS = ["Allow While Using App", "Allow Once", "Allow", "OK"] as const;
const IOS_DISMISS_LABELS = ["Don't Allow", "Don’t Allow", "Don't allow"] as const;

export type IdbResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	stdoutBytes?: Uint8Array;
};

export type IdbExec = (args: string[]) => Promise<IdbResult>;

export type IosDirectDeps = {
	idb?: IdbExec;
	/** When companion screenshot fails (“no active display”), use simctl. */
	screenshotFallback?: (udid: string) => Promise<Uint8Array>;
};

function fail(result: IdbResult, label: string): never {
	throw new Error(
		`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
	);
}

async function requireOk(result: IdbResult, label: string): Promise<IdbResult> {
	if (result.exitCode !== 0) fail(result, label);
	return result;
}

export function createIdbExec(clientBin: string, companionPath: string): IdbExec {
	return async (args) => {
		try {
			const proc = Bun.spawn([clientBin, "--companion-path", companionPath, ...args], {
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

type TargetDescribe = {
	target_type?: string;
	screen_dimensions?: {
		width?: number;
		height?: number;
		width_points?: number;
		height_points?: number;
	};
};

function parseDescribe(stdout: string): TargetDescribe {
	try {
		return JSON.parse(stdout) as TargetDescribe;
	} catch {
		throw new Error(`idb describe returned no JSON: ${stdout.slice(0, 120)}`);
	}
}

function pointSize(info: TargetDescribe): PointerSize {
	const width = info.screen_dimensions?.width_points ?? info.screen_dimensions?.width;
	const height = info.screen_dimensions?.height_points ?? info.screen_dimensions?.height;
	if (!width || !height) {
		throw new Error("idb describe omitted screen_dimensions");
	}
	return { width, height };
}

function defaultIdb(): IdbExec {
	const bins = requireIdbBins();
	return createIdbExec(bins.client, bins.companion);
}

export async function captureViaSimctl(udid: string): Promise<Uint8Array> {
	const dest = join(tmpdir(), `yoqa-simctl-${crypto.randomUUID()}.png`);
	const proc = Bun.spawn(["xcrun", "simctl", "io", udid, "screenshot", dest], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (exitCode !== 0) {
		throw new Error(`simctl screenshot: ${stderr.trim() || `exit ${exitCode}`}`);
	}
	return new Uint8Array(await readFile(dest));
}

/**
 * iOS-simulator Device Session over idb_companion — no Appium server.
 * Android and physical iOS are rejected so connect can fall back to Appium (ADR-0004).
 */
export async function createIosDirectSession(
	options: SessionOptions,
	deps: IosDirectDeps = {},
): Promise<DeviceSession> {
	if (options.platform !== "ios") {
		throw new Error("iOS Direct lane supports iOS simulators only");
	}
	if (looksLikePhysicalIosUdid(options.deviceId)) {
		throw new Error("iOS Direct lane supports simulators only; physical iOS stays on Appium");
	}

	const idb = deps.idb ?? defaultIdb();
	const udid = options.deviceId;
	const described = parseDescribe(
		(await requireOk(await idb(["describe", "--udid", udid, "--json"]), "idb describe")).stdout,
	);
	if (described.target_type && described.target_type !== "simulator") {
		throw new Error("iOS Direct lane supports simulators only; physical iOS stays on Appium");
	}

	const getWindowSize = remember(async () => pointSize(described));
	let lastShotSize: PointerSize | null = null;
	let lastAppId = options.bundleId;
	let pointerStart: { x: number; y: number } | null = null;
	const lock = createLock();

	const run = async (args: string[], label: string) => requireOk(await idb(args), label);

	const captureFrame = async () => {
		const dest = join(tmpdir(), `yoqa-idb-${crypto.randomUUID()}.png`);
		let bytes: Uint8Array;
		try {
			const result = await run(["screenshot", dest, "--udid", udid], "idb screenshot");
			bytes =
				result.stdoutBytes && result.stdoutBytes.byteLength > 8
					? result.stdoutBytes
					: new Uint8Array(await readFile(dest));
			if (bytes.byteLength === 0) throw new Error("idb screenshot returned an empty frame");
		} catch {
			bytes = await (deps.screenshotFallback ?? captureViaSimctl)(udid);
			if (bytes.byteLength === 0) throw new Error("simctl screenshot returned an empty frame");
		}
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
		const result = await run(
			["ui", "describe-all", "--udid", udid, "--json", "--api", "axbridge", "--format", "complete"],
			"idb describe-all",
		);
		const text = result.stdout.trim();
		if (!text.startsWith("{") && !text.startsWith("[")) {
			throw new Error("idb describe-all returned no tree");
		}
		return text;
	};

	const pointerSize = async (coordSpace?: "window" | "screenshot"): Promise<PointerSize> => {
		const window = await getWindowSize();
		if (coordSpace === "screenshot") {
			if (!lastShotSize) await captureFrame();
			return lastShotSize ?? window;
		}
		return window;
	};

	const tapPx = async (x: number, y: number) => {
		await run(["ui", "tap", String(x), String(y), "--udid", udid, "--api", "hid"], "idb ui tap");
	};

	const tap = async (
		xNorm: number,
		yNorm: number,
		tapOptions?: { durationMs?: number; coordSpace?: "window" | "screenshot" },
	) => {
		await lock.withLock(async () => {
			const size = await pointerSize(tapOptions?.coordSpace);
			await tapPx(toPx(xNorm, size.width), toPx(yNorm, size.height));
		});
	};

	const swipe = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		_durationMs = 400,
		swipeOptions?: { coordSpace?: "window" | "screenshot" },
	) => {
		await lock.withLock(async () => {
			const size = await pointerSize(swipeOptions?.coordSpace);
			await run(
				[
					"ui",
					"swipe",
					String(toPx(x1, size.width)),
					String(toPx(y1, size.height)),
					String(toPx(x2, size.width)),
					String(toPx(y2, size.height)),
					"--udid",
					udid,
				],
				"idb ui swipe",
			);
		});
	};

	const type = async (text: string) => {
		await lock.withLock(async () => {
			await run(["ui", "text", text, "--udid", udid], "idb ui text");
		});
	};

	const activateApp = async (appId: string) => {
		await lock.withLock(async () => {
			lastAppId = appId;
			await run(["launch", appId, "--udid", udid], "idb launch");
		});
	};

	const terminateApp = async (appId: string) => {
		await lock.withLock(async () => {
			await run(["terminate", appId, "--udid", udid], "idb terminate");
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await lock.withLock(async () => {
			await run(["ui", "button", "HOME", "--udid", udid], "idb HOME");
			await Bun.sleep(Math.max(0, seconds) * 1000);
			if (lastAppId) {
				await run(["launch", lastAppId, "--udid", udid], "idb launch");
			}
		});
	};

	const openUrl = async (url: string) => {
		await lock.withLock(async () => {
			await run(["open", url, "--udid", udid], "idb open");
		});
	};

	const resolveAlert = async (action: "accept" | "dismiss") => {
		const raw = await pageSource();
		const window = await getWindowSize();
		const labels = action === "accept" ? IOS_ACCEPT_LABELS : IOS_DISMISS_LABELS;
		const hit = cleanPageSource(raw, window).elements.find((el) =>
			labels.some((label) => el.label === label),
		);
		if (!hit) {
			throw new Error(`No ${action} alert button in the idb Screen`);
		}
		await tapPx(
			toPx(hit.x + hit.width / 2, window.width),
			toPx(hit.y + hit.height / 2, window.height),
		);
	};

	const session: DeviceSession = {
		lane: "direct",
		stream: null,
		quit: async () => undefined,
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
				await tapPx(x, y);
			} else {
				await run(
					["ui", "swipe", String(start.x), String(start.y), String(x), String(y), "--udid", udid],
					"idb ui swipe",
				);
			}
		},
		isPointerActive: () => lock.isPointerActive(),
	};
	return session;
}
