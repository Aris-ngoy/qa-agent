import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Capability, DevicePlatform } from "@yoqa/runner-client";
import { type Browser, remote } from "webdriverio";
import { resolveAppium } from "../appium/application";
import type { ResolvedAppium } from "../appium/models";
import { loadDevicePrep } from "../ios/application";

const YOQA_ROOT = join(homedir(), ".yoqa");
const DEFAULT_APPIUM_PORT = Number(process.env.YOQA_APPIUM_PORT ?? "4723");
const DEFAULT_MJPEG_PORT = Number(process.env.YOQA_MJPEG_PORT ?? "9100");
const APPIUM_HOST = process.env.YOQA_APPIUM_HOST ?? "127.0.0.1";
const SCREENSHOT_DIR = join(YOQA_ROOT, "runs", "screenshots");

const MJPEG_SETTINGS_BASE = {
	/** Lower quality keeps high FPS workable over the proxy. */
	mjpegServerScreenshotQuality: 35,
	/** Half-res frames cut encode + bandwidth cost for the Inspector. */
	mjpegScalingFactor: 50,
} as const;

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

type AppiumProcess = {
	proc: ReturnType<typeof Bun.spawn>;
	appium: ResolvedAppium;
	port: number;
};

let appiumProcess: AppiumProcess | null = null;

async function waitForAppium(port: number, timeoutMs = 30_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`http://${APPIUM_HOST}:${port}/status`);
			if (response.ok) return;
		} catch {
			// not ready yet
		}
		await Bun.sleep(400);
	}
	throw new Error(`Appium did not become ready on ${APPIUM_HOST}:${port}`);
}

function appiumCommand(appium: ResolvedAppium, port: number): string[] {
	const args = ["--address", APPIUM_HOST, "--port", String(port), "--relaxed-security"];
	if (appium.invokeViaNode) {
		return [appium.nodeBin ?? "node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
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

async function pickAppiumPort(): Promise<number> {
	if (await isPortFree(DEFAULT_APPIUM_PORT)) return DEFAULT_APPIUM_PORT;
	// Prefer a free port over silently attaching to a foreign Appium
	// that rebuilds WDA without YoQA signing / preinstalled caps.
	for (let offset = 1; offset <= 20; offset++) {
		const candidate = DEFAULT_APPIUM_PORT + offset;
		if (await isPortFree(candidate)) return candidate;
	}
	throw new Error(
		`No free Appium port near ${DEFAULT_APPIUM_PORT}. Quit other Appium processes or set YOQA_APPIUM_PORT.`,
	);
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

export async function ensureAppiumServer(): Promise<number> {
	if (appiumProcess) {
		await waitForAppium(appiumProcess.port);
		return appiumProcess.port;
	}

	const appium = await resolveAppium();
	const port = await pickAppiumPort();
	const command = appiumCommand(appium, port);
	const proc = Bun.spawn(command, {
		cwd: appium.cwd,
		env: { ...process.env, ...appium.env },
		stdout: "ignore",
		stderr: "ignore",
	});
	appiumProcess = { proc, appium, port };
	await waitForAppium(port);
	return port;
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
		"appium:udid": options.deviceId,
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

	if (options.platform === "ios" && options.bundleId && !caps["appium:bundleId"]) {
		caps["appium:bundleId"] = options.bundleId;
	}
	if (options.platform === "android" && options.appPackage && !caps["appium:appPackage"]) {
		caps["appium:appPackage"] = options.appPackage;
	}

	if (options.platform === "ios" && looksLikePhysicalIosUdid(options.deviceId)) {
		const prep = await loadDevicePrep(options.deviceId);
		if (!prep) {
			throw new Error(
				`iOS device ${options.deviceId} is not prepared. Run device setup so WebDriverAgent is installed before starting a run.`,
			);
		}
		// Reuse the YoQA-built/signed WDA instead of Appium's unsigned xcodebuild (code 65).
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
		// Fail connect instead of sitting forever on a wedged WebDriverAgentRunner.
		if (caps["appium:wdaLaunchTimeout"] === undefined) {
			caps["appium:wdaLaunchTimeout"] = 60_000;
		}
		if (caps["appium:wdaConnectionTimeout"] === undefined) {
			caps["appium:wdaConnectionTimeout"] = 60_000;
		}
		// Don't wait for the app to be idle before commands — cheaper under MJPEG.
		if (caps["appium:waitForIdleTimeout"] === undefined) {
			caps["appium:waitForIdleTimeout"] = 0;
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
	const port = await ensureAppiumServer();
	const mjpegPort = await pickMjpegPort();
	const capabilities = await buildW3cCapabilities(options, mjpegPort);

	const browser = await remote({
		hostname: APPIUM_HOST,
		port,
		path: "/",
		capabilities,
		logLevel: "silent",
		connectionRetryCount: 2,
		connectionRetryTimeout: 60_000,
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

	const isMissingSessionError = (error: unknown): boolean => {
		const message = error instanceof Error ? error.message : String(error);
		return /session does not exist|invalid session id|no such session|terminated or not started|session is either terminated/i.test(
			message,
		);
	};

	const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			if (isMissingSessionError(error)) {
				notifySessionDead();
			}
			throw error;
		}
	};

	const getWindowSize = async () => guard(() => browser.getWindowSize());

	const toPx = (norm: number, size: number) =>
		Math.round((Math.min(1000, Math.max(0, norm)) / 1000) * size);

	const quit = async () => {
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
			if (!isMissingSessionError(error)) {
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

	return {
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
}
