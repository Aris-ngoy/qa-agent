import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type PointerSize, pngSizeFromBase64, toPx } from "./android-gestures";
import { looksLikePhysicalIosUdid } from "./appium-lane";
import { requireIdbBins } from "./idb-companion";
import {
	type CapturedFrame,
	DeadSessionError,
	type DeviceSession,
	type PointerPhase,
	type ScreenRecording,
	type SessionOptions,
	guardToolLoss,
	reportLaneFallback,
} from "./lane";
import { remember } from "./once";
import { RECORDER_FINALIZE_MS, exitsWithin, spawnRecorder } from "./recorder-process";
import { cleanPageSource } from "./screen";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import type { StartYoqaAx, YoqaAx } from "./yoqa-ax";
import { type SpawnYoqaSim, type YoqaSim, YoqaSimUnreachableError } from "./yoqa-sim";

const IOS_ACCEPT_LABELS = ["Allow While Using App", "Allow Once", "Allow", "OK"] as const;
const IOS_DISMISS_LABELS = ["Don't Allow", "Don’t Allow", "Don't allow"] as const;

export type IdbResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	stdoutBytes?: Uint8Array;
};

export type IdbExec = (args: string[]) => Promise<IdbResult>;

/** idb could not run, its companion is unreachable, or the simulator is gone. */
const IDB_LOST_RE =
	/StatusCode\.UNAVAILABLE|failed to connect|Connection refused|companion .*(?:not running|terminated)|(?:device|simulator|target) .*not found|not booted/i;

export function idbLostDevice(result: IdbResult): boolean {
	return (
		result.exitCode === 127 ||
		(result.exitCode !== 0 && IDB_LOST_RE.test(`${result.stderr}\n${result.stdout}`))
	);
}

export type IosDirectDeps = {
	idb?: IdbExec;
	/** When companion screenshot fails (“no active display”), use simctl. */
	screenshotFallback?: (udid: string) => Promise<Uint8Array>;
	/**
	 * Serve screenshots from `yoqa-sim` (the `device-sim` implementation). It is spawned on
	 * the first screen or action and killed on quit. When it can't start, the session keeps
	 * idb_companion and says so in its Lane warning.
	 */
	yoqaSim?: SpawnYoqaSim;
	/**
	 * Start the in-simulator accessibility helper (`yoqa-ax`) on the first screen or action,
	 * in the background, and stop it on quit. Nothing waits for it. When it doesn't connect,
	 * the session is degraded: it keeps working, the tree stays on idb_companion, and its
	 * Lane warning says so.
	 */
	yoqaAx?: StartYoqaAx;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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
			return { stdout: "", stderr: errorMessage(error), exitCode: 127 };
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

/** Record the simulator screen with `simctl io recordVideo`; SIGINT makes simctl finalize the mp4. */
export async function recordViaSimctl(udid: string, path: string): Promise<ScreenRecording> {
	await mkdir(dirname(path), { recursive: true });
	const proc = await spawnRecorder(
		["xcrun", "simctl", "io", udid, "recordVideo", "--codec=h264", "--force", path],
		"simctl recordVideo",
	);
	return {
		stop: async () => {
			proc.kill("SIGINT");
			if (!(await exitsWithin(proc, RECORDER_FINALIZE_MS))) {
				proc.kill("SIGKILL");
				throw new Error("simctl did not finish writing the video");
			}
		},
	};
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

	const connectIdb = deps.idb ?? defaultIdb();
	const udid = options.deviceId;
	const described = parseDescribe(
		(await requireOk(await connectIdb(["describe", "--udid", udid, "--json"]), "idb describe"))
			.stdout,
	);
	if (described.target_type && described.target_type !== "simulator") {
		throw new Error("iOS Direct lane supports simulators only; physical iOS stays on Appium");
	}

	const idb = guardToolLoss(connectIdb, idbLostDevice, options.onSessionDead);

	const getWindowSize = remember(async () => pointSize(described));
	let lastShotSize: PointerSize | null = null;
	let lastAppId = options.bundleId;
	let pointerStart: { x: number; y: number } | null = null;
	const lock = createLock();

	const run = async (args: string[], label: string) => requireOk(await idb(args), label);

	/** One `yoqa-sim` per session, spawned on first use; null once it failed. */
	let yoqaSim: Promise<YoqaSim | null> | null = null;
	let quitting = false;
	const yoqaSimFailed = (error: unknown) =>
		reportLaneFallback(
			session,
			options,
			`yoqa-sim failed; using idb_companion for the rest of the session (${errorMessage(error)})`,
		);
	const ensureYoqaSim = (): Promise<YoqaSim | null> => {
		const spawn = deps.yoqaSim;
		if (!spawn || quitting) return Promise.resolve(null);
		yoqaSim ??= spawn(udid).catch((error: unknown) => {
			yoqaSimFailed(error);
			return null;
		});
		return yoqaSim;
	};
	/**
	 * Run `use` on `yoqa-sim`, or return null when there is none. When it can't be reached,
	 * stop it and return null, so the caller does the same with idb_companion for the rest of
	 * the session. Any other failure may already have touched the screen, so a gesture
	 * (`retryable: false`) rethrows it instead of being sent twice; a frame read retries.
	 */
	const viaYoqaSim = async <T>(
		use: (running: YoqaSim) => Promise<T>,
		retryable = false,
	): Promise<{ value: T } | null> => {
		const running = await startHelpers();
		if (!running) return null;
		try {
			return { value: await use(running) };
		} catch (error) {
			if (!retryable && !(error instanceof YoqaSimUnreachableError)) throw error;
			yoqaSimFailed(error);
			yoqaSim = Promise.resolve(null);
			await running.stop().catch(() => undefined);
			return null;
		}
	};
	/** 0–1000 to the 0.0–1.0 `yoqa-sim` takes; the conversion happens here, at the Lane's edge. */
	const fraction = (norm: number) => Math.min(1, Math.max(0, norm / 1000));

	/** One `yoqa-ax` per session, started on first use; null once it failed. */
	let yoqaAx: Promise<YoqaAx | null> | null = null;
	const ensureYoqaAx = () => {
		const start = deps.yoqaAx;
		if (!start || quitting || yoqaAx) return;
		yoqaAx = start(udid).catch((error: unknown) => {
			reportLaneFallback(
				session,
				options,
				`Session degraded: yoqa-ax is unavailable, so the tree stays on idb_companion (${errorMessage(error)})`,
			);
			return null;
		});
	};

	/** Start the session's helpers on its first screen or action. */
	const startHelpers = () => {
		ensureYoqaAx();
		return ensureYoqaSim();
	};

	/**
	 * Run an action under the lock. The first one also starts `yoqa-sim`; gestures then wait
	 * for it to be up (once per session), while other actions go on with idb_companion.
	 */
	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => {
		void startHelpers();
		return lock.withLock(fn);
	};

	const captureViaIdb = async (): Promise<Uint8Array> => {
		const dest = join(tmpdir(), `yoqa-idb-${crypto.randomUUID()}.png`);
		let bytes: Uint8Array;
		try {
			const result = await run(["screenshot", dest, "--udid", udid], "idb screenshot");
			bytes =
				result.stdoutBytes && result.stdoutBytes.byteLength > 8
					? result.stdoutBytes
					: new Uint8Array(await readFile(dest));
			if (bytes.byteLength === 0) throw new Error("idb screenshot returned an empty frame");
		} catch (error) {
			if (error instanceof DeadSessionError) throw error;
			bytes = await (deps.screenshotFallback ?? captureViaSimctl)(udid);
			if (bytes.byteLength === 0) throw new Error("simctl screenshot returned an empty frame");
		}
		return bytes;
	};

	const captureFrame = async (): Promise<CapturedFrame> => {
		const fromYoqaSim = await viaYoqaSim(async (running) => {
			const frame = await running.frame();
			if (frame.bytes.byteLength === 0) throw new Error("empty frame");
			return frame;
		}, true);
		const bytes = fromYoqaSim?.value.bytes ?? (await captureViaIdb());
		const base64 = Buffer.from(bytes).toString("base64");
		lastShotSize = pngSizeFromBase64(base64) ?? lastShotSize;
		const hash = fromYoqaSim?.value.hash;
		return { base64, mime: "image/png", ...(hash ? { hash } : {}) };
	};

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	const pageSource = async () => {
		void startHelpers();
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

	/** A tap at 0–1000. Both coordinate spaces are the full screen, so fractions need no size. */
	const tapNorm = async (
		xNorm: number,
		yNorm: number,
		tapOptions?: { durationMs?: number; coordSpace?: "window" | "screenshot" },
	) => {
		const sent = await viaYoqaSim((running) =>
			running.tap(fraction(xNorm), fraction(yNorm), tapOptions?.durationMs),
		);
		if (sent) return;
		const size = await pointerSize(tapOptions?.coordSpace);
		await tapPx(toPx(xNorm, size.width), toPx(yNorm, size.height));
	};

	const swipeNorm = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs: number | undefined,
		coordSpace?: "window" | "screenshot",
	) => {
		const sent = await viaYoqaSim((running) =>
			running.swipe(
				{ x: fraction(x1), y: fraction(y1) },
				{ x: fraction(x2), y: fraction(y2) },
				durationMs,
			),
		);
		if (sent) return;
		const size = await pointerSize(coordSpace);
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
	};

	const tap = async (
		xNorm: number,
		yNorm: number,
		tapOptions?: { durationMs?: number; coordSpace?: "window" | "screenshot" },
	) => {
		await withActionLock(() => tapNorm(xNorm, yNorm, tapOptions));
	};

	const swipe = async (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs = 400,
		swipeOptions?: { coordSpace?: "window" | "screenshot" },
	) => {
		await withActionLock(() => swipeNorm(x1, y1, x2, y2, durationMs, swipeOptions?.coordSpace));
	};

	const type = async (text: string) => {
		await withActionLock(async () => {
			await run(["ui", "text", text, "--udid", udid], "idb ui text");
		});
	};

	const activateApp = async (appId: string) => {
		await withActionLock(async () => {
			lastAppId = appId;
			await run(["launch", appId, "--udid", udid], "idb launch");
		});
	};

	const terminateApp = async (appId: string) => {
		await withActionLock(async () => {
			await run(["terminate", appId, "--udid", udid], "idb terminate");
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await withActionLock(async () => {
			const pressed = await viaYoqaSim((running) => running.key("home"));
			if (!pressed) await run(["ui", "button", "HOME", "--udid", udid], "idb HOME");
			await Bun.sleep(Math.max(0, seconds) * 1000);
			if (lastAppId) {
				await run(["launch", lastAppId, "--udid", udid], "idb launch");
			}
		});
	};

	const openUrl = async (url: string) => {
		await withActionLock(async () => {
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
		await tapNorm(hit.x + hit.width / 2, hit.y + hit.height / 2);
	};

	const session: DeviceSession = {
		lane: "direct",
		stream: null,
		quit: async () => {
			quitting = true;
			const [running, ax] = await Promise.all([yoqaSim, yoqaAx]);
			yoqaSim = null;
			yoqaAx = null;
			await Promise.all([running?.stop(), ax?.stop()]);
		},
		startRecording: (path) => recordViaSimctl(udid, path),
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
		acceptAlert: () => withActionLock(() => resolveAlert("accept")),
		dismissAlert: () => withActionLock(() => resolveAlert("dismiss")),
		withActionLock,
		pointerEvent: async (phase: PointerPhase, xNorm: number, yNorm: number) => {
			if (phase === "begin") {
				pointerStart = { x: xNorm, y: yNorm };
				lock.setPointerActive(true);
				return;
			}
			if (phase === "move") {
				pointerStart = pointerStart ?? { x: xNorm, y: yNorm };
				return;
			}
			const start = pointerStart ?? { x: xNorm, y: yNorm };
			pointerStart = null;
			lock.setPointerActive(false);
			if (start.x === xNorm && start.y === yNorm) {
				await tapNorm(xNorm, yNorm, { coordSpace: "screenshot" });
			} else {
				await swipeNorm(start.x, start.y, xNorm, yNorm, undefined, "screenshot");
			}
		},
		isPointerActive: () => lock.isPointerActive(),
	};
	return session;
}
