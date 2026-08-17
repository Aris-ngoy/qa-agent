import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Capability, DevicePlatform } from "@yoqa/runner-client";
import { type Browser, remote } from "webdriverio";
import { APPIUM_HOST, ensureAppiumServer } from "../appium/server";
import { loadDevicePrep } from "../ios/application";
import { resolveAndroidAppiumIdentity } from "./application";

const YOQA_ROOT = join(homedir(), ".yoqa");
const DEFAULT_MJPEG_PORT = Number(process.env.YOQA_MJPEG_PORT ?? "9100");
const SCREENSHOT_DIR = join(YOQA_ROOT, "runs", "screenshots");

const MJPEG_SETTINGS_BASE = {
	/** Lower quality keeps high FPS workable over the proxy. */
	mjpegServerScreenshotQuality: 35,
	/** Half-res frames cut encode + bandwidth cost for the Inspector. */
	mjpegScalingFactor: 50,
} as const;

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

/** Notified when exclusivity releases a prior session for a device id. */
let exclusiveReleaseListener: ((deviceId: string) => void) | null = null;

/** Active Session registry uses this to clear its singleton when a Run (or other create) takes the device. */
export function onDeviceSessionExclusiveRelease(listener: (deviceId: string) => void): void {
	exclusiveReleaseListener = listener;
}

const DEAD_SESSION_RE =
	/session does not exist|invalid session id|no such session|terminated or not started|session is either terminated/i;

/** Stable error for a Device Session Appium has already dropped. */
export class DeadSessionError extends Error {
	constructor(message = "Device session ended") {
		super(message);
		this.name = "DeadSessionError";
	}
}

/** True when Appium reports the WebDriver session is gone (Dead Session). */
export function isDeadSessionError(error: unknown): boolean {
	if (error instanceof DeadSessionError) return true;
	const message = error instanceof Error ? error.message : String(error);
	return DEAD_SESSION_RE.test(message);
}

/** Simulators can sustain 60; real devices need a much gentler encode load. */
function mjpegSettingsForDevice(options: {
	platform: DevicePlatform;
	deviceId: string;
}): Record<string, number> {
	const physicalIos = options.platform === "ios" && looksLikePhysicalIosUdid(options.deviceId);
	if (physicalIos) {
		return {
			mjpegServerFramerate: 15,
			mjpegServerScreenshotQuality: 25,
			mjpegScalingFactor: 40,
		};
	}
	return {
		...MJPEG_SETTINGS_BASE,
		mjpegServerFramerate: 60,
	};
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen(port, APPIUM_HOST, () => {
			server.close(() => resolve(true));
		});
	});
}

async function pickMjpegPort(): Promise<number> {
	if (await isPortFree(DEFAULT_MJPEG_PORT)) return DEFAULT_MJPEG_PORT;
	for (let offset = 1; offset <= 40; offset++) {
		const candidate = DEFAULT_MJPEG_PORT + offset;
		if (await isPortFree(candidate)) return candidate;
	}
	throw new Error(
		`No free MJPEG port near ${DEFAULT_MJPEG_PORT}. Quit other streams or set YOQA_MJPEG_PORT.`,
	);
}

export function mjpegUpstreamUrl(mjpegPort: number): string {
	return `http://127.0.0.1:${mjpegPort}/`;
}

async function probeMjpegStream(mjpegPort: number, timeoutMs = 4000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 800);
		try {
			const response = await fetch(mjpegUpstreamUrl(mjpegPort), {
				signal: controller.signal,
				headers: { Accept: "multipart/x-mixed-replace,image/jpeg,*/*" },
			});
			if (response.ok) {
				controller.abort();
				return true;
			}
		} catch {
			// not ready yet
		} finally {
			clearTimeout(timer);
		}
		await Bun.sleep(250);
	}
	return false;
}

async function applyMjpegSettings(
	browser: Browser,
	options: { platform: DevicePlatform; deviceId: string },
): Promise<void> {
	try {
		await browser.updateSettings(mjpegSettingsForDevice(options));
	} catch (error) {
		console.warn(
			"[yoqa-runner] MJPEG settings update failed:",
			error instanceof Error ? error.message : error,
		);
	}
}

async function releaseExistingSession(deviceId: string): Promise<void> {
	const existing = openByDeviceId.get(deviceId);
	if (!existing) return;
	openByDeviceId.delete(deviceId);
	exclusiveReleaseListener?.(deviceId);
	try {
		await existing.quit();
	} catch (error) {
		console.warn(
			"[yoqa-runner] quit prior Device Session for exclusivity:",
			error instanceof Error ? error.message : error,
		);
	}
}

function capabilitiesToRecord(caps: Capability[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const cap of caps) {
		const key = cap.key.trim();
		if (!key) continue;
		out[key] = cap.value;
	}
	return out;
}

export function mergeCapabilities(
	appCaps: Capability[],
	caseCaps: Capability[],
): Record<string, string> {
	return {
		...capabilitiesToRecord(appCaps),
		...capabilitiesToRecord(caseCaps),
	};
}

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	appCaps: Capability[];
	caseCaps: Capability[];
	bundleId?: string;
	appPackage?: string;
	/** Called once when Appium reports the session is gone. */
	onSessionDead?: () => void;
};

export type CapturedFrame = {
	base64: string;
	mime: "image/png" | "image/jpeg";
};

export type PointerPhase = "begin" | "move" | "end";

export type DeviceSession = {
	browser: Browser;
	mjpegPort: number;
	streamReady: boolean;
	quit: () => Promise<void>;
	/** In-memory frame for live feed / grounding — never writes disk. */
	captureFrame: () => Promise<CapturedFrame>;
	/** Persist a screenshot under ~/.yoqa/runs/screenshots/. */
	screenshot: () => Promise<{ path: string; base64: string }>;
	pageSource: () => Promise<string>;
	getWindowSize: () => Promise<{ width: number; height: number }>;
	tap: (xNorm: number, yNorm: number, options?: { durationMs?: number }) => Promise<void>;
	swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	drag: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	type: (text: string) => Promise<void>;
	activateApp: (appId: string) => Promise<void>;
	terminateApp: (appId: string) => Promise<void>;
	backgroundApp: (seconds?: number) => Promise<void>;
	openUrl: (url: string) => Promise<void>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
	/** Run an exclusive device action (blocks live pointer + other actions). */
	withActionLock: <T>(fn: () => Promise<T>) => Promise<T>;
	pointerEvent: (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => Promise<void>;
	isPointerActive: () => boolean;
};

/** Apple physical UDIDs look like `00008120-000E6D813E2A601E` (not a standard UUID). */
function looksLikePhysicalIosUdid(udid: string): boolean {
	return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(udid.trim());
}

/** First simulator connect compiles WebDriverAgent; physical devices reuse a preinstalled WDA. */
export const PHYSICAL_IOS_SESSION_TIMEOUT_MS = 60_000;
export const SIMULATOR_WDA_SESSION_TIMEOUT_MS = 600_000;
const SIMULATOR_WDA_DERIVED_DATA = join(YOQA_ROOT, "wda-sim");

export function iosSessionCreateTimeoutMs(deviceId: string): number {
	return looksLikePhysicalIosUdid(deviceId)
		? PHYSICAL_IOS_SESSION_TIMEOUT_MS
		: SIMULATOR_WDA_SESSION_TIMEOUT_MS;
}

async function buildW3cCapabilities(
	options: SessionOptions,
	mjpegPort: number,
): Promise<Record<string, unknown>> {
	const merged = mergeCapabilities(options.appCaps, options.caseCaps);
	const platformName = options.platform === "ios" ? "iOS" : "Android";
	const automationName = options.platform === "ios" ? "XCUITest" : "UiAutomator2";

	const caps: Record<string, unknown> = {
		platformName,
		"appium:automationName": automationName,
		"appium:newCommandTimeout": 3600,
		// Expose WDA/UIA2 MJPEG for our /stream.mjpeg proxy. Do NOT set
		// mjpegScreenshotUrl — that requires the optional `mjpeg-consumer`
		// Appium package and we capture one-shots via takeScreenshot instead.
		"appium:mjpegServerPort": mjpegPort,
		...Object.fromEntries(
			Object.entries(merged).map(([key, value]) =>
				key.includes(":") ? [key, value] : [`appium:${key}`, value],
			),
		),
	};

	if (options.platform === "ios") {
		if (caps["appium:udid"] === undefined) {
			caps["appium:udid"] = options.deviceId;
		}
		if (options.bundleId && !caps["appium:bundleId"]) {
			caps["appium:bundleId"] = options.bundleId;
		}
		const physical = looksLikePhysicalIosUdid(options.deviceId);
		if (physical) {
			const prep = await loadDevicePrep(options.deviceId);
			if (!prep) {
				throw new Error(
					`iOS device ${options.deviceId} is not prepared. Run device setup so WebDriverAgent is installed before starting a run.`,
				);
			}
			// Reuse the Yoqa-built/signed WDA instead of Appium's unsigned xcodebuild (code 65).
			if (caps["appium:usePreinstalledWDA"] === undefined) {
				caps["appium:usePreinstalledWDA"] = true;
			}
			if (!caps["appium:updatedWDABundleId"]) {
				caps["appium:updatedWDABundleId"] = prep.bundleId;
			}
			if (!caps["appium:xcodeOrgId"]) {
				caps["appium:xcodeOrgId"] = prep.developmentTeam;
			}
			if (!caps["appium:xcodeSigningId"]) {
				caps["appium:xcodeSigningId"] = "Apple Development";
			}
		}
		// Simulator first-connect compiles WDA (often several minutes on a cold CI runner).
		const wdaTimeoutMs = iosSessionCreateTimeoutMs(options.deviceId);
		if (caps["appium:wdaLaunchTimeout"] === undefined) {
			caps["appium:wdaLaunchTimeout"] = wdaTimeoutMs;
		}
		if (caps["appium:wdaConnectionTimeout"] === undefined) {
			caps["appium:wdaConnectionTimeout"] = wdaTimeoutMs;
		}
		if (caps["appium:waitForIdleTimeout"] === undefined) {
			caps["appium:waitForIdleTimeout"] = 0;
		}
		if (!physical && caps["appium:derivedDataPath"] === undefined) {
			await mkdir(SIMULATOR_WDA_DERIVED_DATA, { recursive: true });
			caps["appium:derivedDataPath"] = SIMULATOR_WDA_DERIVED_DATA;
		}
	}

	if (options.platform === "android") {
		const requested = String(caps["appium:udid"] ?? options.deviceId);
		const identity = await resolveAndroidAppiumIdentity(requested);
		if (identity.udid) {
			caps["appium:udid"] = identity.udid;
		}
		if (identity.avd && caps["appium:avd"] === undefined) {
			caps["appium:avd"] = identity.avd;
		}
		if (options.appPackage && !caps["appium:appPackage"]) {
			caps["appium:appPackage"] = options.appPackage;
		}
	}

	return caps;
}

class ActionGate {
	private locked = false;
	/** Buffered live gesture — Appium only sees one complete tap/drag on end. */
	private gesture: {
		startXNorm: number;
		startYNorm: number;
		endXNorm: number;
		endYNorm: number;
		startedAt: number;
		lastSeq: number;
		double: boolean;
	} | null = null;
	/** Single tap waiting to see if a second tap arrives (double-click). */
	private deferredTap: {
		gesture: NonNullable<ActionGate["gesture"]>;
		browser: Browser;
		toPx: (norm: number, size: number) => number;
		getWindowSize: () => Promise<{ width: number; height: number }>;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;

	isPointerActive(): boolean {
		return this.gesture != null || this.deferredTap != null;
	}

	async withLock<T>(fn: () => Promise<T>): Promise<T> {
		if (this.gesture || this.deferredTap) {
			throw new Error("Device is busy with live pointer control");
		}
		if (this.locked) {
			throw new Error("Device is busy with another action");
		}
		this.locked = true;
		try {
			return await fn();
		} finally {
			this.locked = false;
		}
	}

	async handlePointer(
		browser: Browser,
		toPx: (norm: number, size: number) => number,
		getWindowSize: () => Promise<{ width: number; height: number }>,
		phase: PointerPhase,
		xNorm: number,
		yNorm: number,
		seq: number,
	): Promise<void> {
		if (this.locked && !this.gesture && !this.deferredTap) {
			throw new Error("Device is busy with another action");
		}

		const x = Math.min(1000, Math.max(0, xNorm));
		const y = Math.min(1000, Math.max(0, yNorm));
		/** Normalized grid distance for double-click pairing (~5% of screen). */
		const doubleSlopNorm = 50;
		const doubleTapMs = 320;

		if (phase === "begin") {
			if (this.deferredTap) {
				const pending = this.deferredTap;
				const near =
					Math.hypot(x - pending.gesture.startXNorm, y - pending.gesture.startYNorm) <
					doubleSlopNorm;
				clearTimeout(pending.timer);
				this.deferredTap = null;
				if (near) {
					this.locked = true;
					this.gesture = {
						startXNorm: pending.gesture.startXNorm,
						startYNorm: pending.gesture.startYNorm,
						endXNorm: x,
						endYNorm: y,
						startedAt: Date.now(),
						lastSeq: seq,
						double: true,
					};
					return;
				}
				await this.flushGesture(
					pending.gesture,
					pending.browser,
					pending.toPx,
					pending.getWindowSize,
				);
			}

			if (this.gesture) {
				await this.flushGesture(this.gesture, browser, toPx, getWindowSize);
				this.gesture = null;
			}
			this.locked = true;
			this.gesture = {
				startXNorm: x,
				startYNorm: y,
				endXNorm: x,
				endYNorm: y,
				startedAt: Date.now(),
				lastSeq: seq,
				double: false,
			};
			return;
		}

		if (!this.gesture) {
			throw new Error("No active pointer — send begin before move/end");
		}

		if (phase === "move") {
			if (seq < this.gesture.lastSeq) return;
			this.gesture.lastSeq = seq;
			this.gesture.endXNorm = x;
			this.gesture.endYNorm = y;
			return;
		}

		this.gesture.endXNorm = x;
		this.gesture.endYNorm = y;

		const size = await getWindowSize();
		const startX = toPx(this.gesture.startXNorm, size.width);
		const startY = toPx(this.gesture.startYNorm, size.height);
		const endX = toPx(this.gesture.endXNorm, size.width);
		const endY = toPx(this.gesture.endYNorm, size.height);
		const distance = Math.hypot(endX - startX, endY - startY);
		const tapSlopPx = 12;

		if (distance >= tapSlopPx || this.gesture.double) {
			const gesture = this.gesture;
			this.gesture = null;
			await this.flushGesture(gesture, browser, toPx, getWindowSize);
			return;
		}

		// Defer single tap so a quick second click can become a double-tap.
		const gesture = this.gesture;
		this.gesture = null;
		const timer = setTimeout(() => {
			if (this.deferredTap?.timer !== timer) return;
			const pending = this.deferredTap;
			this.deferredTap = null;
			void this.flushGesture(
				pending.gesture,
				pending.browser,
				pending.toPx,
				pending.getWindowSize,
			).catch((error) => {
				console.warn(
					"[yoqa-runner] deferred tap failed:",
					error instanceof Error ? error.message : error,
				);
				this.locked = false;
			});
		}, doubleTapMs);
		this.deferredTap = { gesture, browser, toPx, getWindowSize, timer };
	}

	/** Flush buffered begin→move→end as a single WDA-safe performActions chain. */
	private async flushGesture(
		gesture: NonNullable<ActionGate["gesture"]>,
		browser: Browser,
		toPx: (norm: number, size: number) => number,
		getWindowSize: () => Promise<{ width: number; height: number }>,
	): Promise<void> {
		const size = await getWindowSize();
		const startX = toPx(gesture.startXNorm, size.width);
		const startY = toPx(gesture.startYNorm, size.height);
		const endX = toPx(gesture.endXNorm, size.width);
		const endY = toPx(gesture.endYNorm, size.height);
		const distance = Math.hypot(endX - startX, endY - startY);
		const elapsedMs = Math.max(50, Date.now() - gesture.startedAt);
		const tapSlopPx = 12;

		try {
			if (distance < tapSlopPx || gesture.double) {
				const holdMs = Math.min(200, elapsedMs);
				const tapOnce = async () => {
					await browser.performActions([
						{
							type: "pointer",
							id: "finger1",
							parameters: { pointerType: "touch" },
							actions: [
								{ type: "pointerMove", duration: 0, x: startX, y: startY },
								{ type: "pointerDown", button: 0 },
								{ type: "pause", duration: holdMs },
								{ type: "pointerUp", button: 0 },
							],
						},
					]);
					try {
						await browser.releaseActions();
					} catch {
						// ignore
					}
				};
				await tapOnce();
				if (gesture.double) {
					await Bun.sleep(50);
					await tapOnce();
				}
			} else {
				const duration = Math.min(2000, Math.max(80, elapsedMs));
				await browser.performActions([
					{
						type: "pointer",
						id: "finger1",
						parameters: { pointerType: "touch" },
						actions: [
							{ type: "pointerMove", duration: 0, x: startX, y: startY },
							{ type: "pointerDown", button: 0 },
							{ type: "pointerMove", duration, x: endX, y: endY },
							{ type: "pointerUp", button: 0 },
						],
					},
				]);
				try {
					await browser.releaseActions();
				} catch {
					// ignore
				}
			}
		} finally {
			this.locked = false;
		}
	}

	async forceEnd(
		browser: Browser,
		toPx?: (norm: number, size: number) => number,
		getWindowSize?: () => Promise<{ width: number; height: number }>,
	): Promise<void> {
		if (this.deferredTap) {
			clearTimeout(this.deferredTap.timer);
			const pending = this.deferredTap;
			this.deferredTap = null;
			if (toPx && getWindowSize) {
				try {
					await this.flushGesture(pending.gesture, pending.browser, toPx, getWindowSize);
				} catch {
					this.locked = false;
				}
			} else {
				this.locked = false;
			}
			return;
		}
		if (!this.gesture) {
			this.locked = false;
			return;
		}
		if (!toPx || !getWindowSize) {
			this.gesture = null;
			this.locked = false;
			return;
		}
		const gesture = this.gesture;
		this.gesture = null;
		try {
			await this.flushGesture(gesture, browser, toPx, getWindowSize);
		} catch {
			this.locked = false;
		}
	}
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function createDeviceSession(options: SessionOptions): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	const port = await ensureAppiumServer();
	const mjpegPort = await pickMjpegPort();
	const capabilities = await buildW3cCapabilities(options, mjpegPort);

	const simulatorIos = options.platform === "ios" && !looksLikePhysicalIosUdid(options.deviceId);
	const sessionCreateTimeoutMs = simulatorIos
		? iosSessionCreateTimeoutMs(options.deviceId)
		: 60_000;

	const browser = await remote({
		hostname: APPIUM_HOST,
		port,
		path: "/",
		capabilities,
		logLevel: "silent",
		// Do not retry a still-running WDA compile — a second POST /session races the first.
		connectionRetryCount: simulatorIos ? 0 : 2,
		connectionRetryTimeout: sessionCreateTimeoutMs,
	});

	await applyMjpegSettings(browser, {
		platform: options.platform,
		deviceId: options.deviceId,
	});
	const streamReady = await probeMjpegStream(mjpegPort);
	if (!streamReady) {
		console.warn(
			`[yoqa-runner] MJPEG stream not reachable on port ${mjpegPort}; Inspector will fall back to screenshot polling`,
		);
	}

	const gate = new ActionGate();
	let sessionDeadNotified = false;
	const notifySessionDead = () => {
		if (sessionDeadNotified) return;
		sessionDeadNotified = true;
		options.onSessionDead?.();
	};

	const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			if (isDeadSessionError(error)) {
				notifySessionDead();
			}
			throw error;
		}
	};

	const getWindowSize = async () => guard(() => browser.getWindowSize());

	const toPx = (norm: number, size: number) =>
		Math.round((Math.min(1000, Math.max(0, norm)) / 1000) * size);

	const owned: { current: DeviceSession | null } = { current: null };

	const quit = async () => {
		if (openByDeviceId.get(options.deviceId) === owned.current) {
			openByDeviceId.delete(options.deviceId);
		}
		// Only flush an in-flight live gesture — never block quit on a dead WDA.
		if (gate.isPointerActive() && !sessionDeadNotified) {
			try {
				await withTimeout(gate.forceEnd(browser, toPx, getWindowSize), 3_000, "live gesture flush");
			} catch (error) {
				console.warn(
					"[yoqa-runner] gesture flush on quit:",
					error instanceof Error ? error.message : error,
				);
			}
		}
		if (sessionDeadNotified) return;
		try {
			// WDA often hangs on DELETE while MJPEG clients are still attached;
			// callers abort proxies first, and we still bound deleteSession.
			await withTimeout(browser.deleteSession(), 8_000, "deleteSession");
		} catch (error) {
			if (!isDeadSessionError(error)) {
				console.warn(
					"[yoqa-runner] deleteSession failed:",
					error instanceof Error ? error.message : error,
				);
			}
		} finally {
			sessionDeadNotified = true;
		}
	};

	const captureFrame = async (): Promise<CapturedFrame> =>
		guard(async () => {
			const base64 = await browser.takeScreenshot();
			// Appium returns PNG base64 for takeScreenshot even when MJPEG is JPEG upstream.
			return { base64, mime: "image/png" as const };
		});

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const frame = await captureFrame();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(frame.base64, "base64")));
		return { path, base64: frame.base64 };
	};

	const pageSource = async () => guard(() => browser.getPageSource());

	const tap = async (xNorm: number, yNorm: number, tapOptions?: { durationMs?: number }) => {
		await gate.withLock(async () => {
			await guard(async () => {
				const size = await getWindowSize();
				const x = toPx(xNorm, size.width);
				const y = toPx(yNorm, size.height);
				const holdMs = Math.max(50, tapOptions?.durationMs ?? 50);
				await browser.performActions([
					{
						type: "pointer",
						id: "finger1",
						parameters: { pointerType: "touch" },
						actions: [
							{ type: "pointerMove", duration: 0, x, y },
							{ type: "pointerDown", button: 0 },
							{ type: "pause", duration: holdMs },
							{ type: "pointerUp", button: 0 },
						],
					},
				]);
				await browser.releaseActions();
			});
		});
	};

	const swipe = async (x1: number, y1: number, x2: number, y2: number, durationMs = 400) => {
		await gate.withLock(async () => {
			await guard(async () => {
				const size = await getWindowSize();
				await browser.performActions([
					{
						type: "pointer",
						id: "finger1",
						parameters: { pointerType: "touch" },
						actions: [
							{
								type: "pointerMove",
								duration: 0,
								x: toPx(x1, size.width),
								y: toPx(y1, size.height),
							},
							{ type: "pointerDown", button: 0 },
							{
								type: "pointerMove",
								duration: durationMs,
								x: toPx(x2, size.width),
								y: toPx(y2, size.height),
							},
							{ type: "pointerUp", button: 0 },
						],
					},
				]);
				await browser.releaseActions();
			});
		});
	};

	const drag = async (x1: number, y1: number, x2: number, y2: number, durationMs = 800) => {
		await swipe(x1, y1, x2, y2, durationMs);
	};

	const type = async (text: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.keys(text.split(""));
			});
		});
	};

	const activateApp = async (appId: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.execute("mobile: activateApp", { bundleId: appId, appId });
			});
		});
	};

	const terminateApp = async (appId: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.execute("mobile: terminateApp", { bundleId: appId, appId });
			});
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.execute("mobile: backgroundApp", { seconds });
			});
		});
	};

	const openUrl = async (url: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.url(url);
			});
		});
	};

	const acceptAlert = async () => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.acceptAlert();
			});
		});
	};

	const dismissAlert = async () => {
		await gate.withLock(async () => {
			await guard(async () => {
				await browser.dismissAlert();
			});
		});
	};

	const pointerEvent = async (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => {
		await guard(async () => {
			await gate.handlePointer(browser, toPx, getWindowSize, phase, xNorm, yNorm, seq);
		});
	};

	const session: DeviceSession = {
		browser,
		mjpegPort,
		streamReady,
		quit,
		captureFrame,
		screenshot,
		pageSource,
		getWindowSize,
		tap,
		swipe,
		drag,
		type,
		activateApp,
		terminateApp,
		backgroundApp,
		openUrl,
		acceptAlert,
		dismissAlert,
		withActionLock: <T>(fn: () => Promise<T>) => gate.withLock(fn),
		pointerEvent,
		isPointerActive: () => gate.isPointerActive(),
	};
	owned.current = session;

	openByDeviceId.set(options.deviceId, session);
	return session;
}
