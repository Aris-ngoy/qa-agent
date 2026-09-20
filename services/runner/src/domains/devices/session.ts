import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import {
	AgentDeviceError,
	agentDeviceSessionName,
	conflictingSessionAddress,
	isDeadAgentDeviceSessionError,
	isRunnerNotInstalledError,
	runAgentDevice,
} from "../agent-device/cli";
import { installYoqaRunnerOnDevice } from "../agent-device/runner-install";

const YOQA_ROOT = join(process.env.HOME ?? tmpdir(), ".yoqa");
const SCREENSHOT_DIR = join(YOQA_ROOT, "runs", "screenshots");
const OPEN_TIMEOUT_MS = 300_000;

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

/** Stable error for a Device Session agent-device has already dropped. */
export class DeadSessionError extends Error {
	constructor(message = "Device session ended") {
		super(message);
		this.name = "DeadSessionError";
	}
}

/** True when agent-device reports the session is gone (Dead Session). */
export function isDeadSessionError(error: unknown): boolean {
	if (error instanceof DeadSessionError) return true;
	if (isDeadAgentDeviceSessionError(error)) return true;
	const message = error instanceof Error ? error.message : String(error);
	return /session does not exist|invalid session|no such session|no active session|session.+not found|terminated or not started|session is either terminated/i.test(
		message,
	);
}

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	/** Physical vs simulator — enables check-and-install of YoqaADRunner on connect. */
	kind?: DeviceKind;
	bundleId?: string;
	appPackage?: string;
	/** Called once when agent-device reports the session is gone. */
	onSessionDead?: () => void;
};

export type CapturedFrame = {
	base64: string;
	mime: "image/png" | "image/jpeg";
};

export type PointerPhase = "begin" | "move" | "end";

export type SnapshotNode = {
	ref: string;
	type?: string;
	role?: string;
	label?: string;
	value?: string;
	identifier?: string;
	rect?: { x: number; y: number; width: number; height: number };
	enabled?: boolean;
};

export type DeviceSession = {
	quit: () => Promise<void>;
	/** In-memory frame for live feed / grounding — never persists under runs/. */
	captureFrame: () => Promise<CapturedFrame>;
	/** Persist a screenshot under ~/.yoqa/runs/screenshots/. */
	screenshot: () => Promise<{ path: string; base64: string }>;
	snapshotNodes: () => Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}>;
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
	/** System back navigation (agent-device `back`). */
	back: () => Promise<void>;
	/** Semantic scroll (agent-device `scroll <direction> [amount]`). */
	scroll: (direction: "up" | "down" | "left" | "right", amount?: number) => Promise<void>;
	/** Bare home-screen press (agent-device `home`; no sleep/reopen unlike backgroundApp). */
	home: () => Promise<void>;
	/** Device keyboard control (agent-device `keyboard dismiss|enter`). */
	keyboard: (action: "dismiss" | "enter") => Promise<void>;
	/** Run an exclusive device action (blocks live pointer + other actions). */
	withActionLock: <T>(fn: () => Promise<T>) => Promise<T>;
	pointerEvent: (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => Promise<void>;
	isPointerActive: () => boolean;
};

function defaultWindowFor(platform: DevicePlatform): { width: number; height: number } {
	return platform === "ios" ? { width: 402, height: 874 } : { width: 412, height: 915 };
}

function windowFromNodes(
	nodes: SnapshotNode[],
	platform: DevicePlatform,
): { width: number; height: number } {
	let maxX = 0;
	let maxY = 0;
	for (const node of nodes) {
		const rect = node.rect;
		if (!rect) continue;
		if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
		if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
	}
	if (maxX < 50 || maxY < 50) return defaultWindowFor(platform);
	return { width: Math.round(maxX), height: Math.round(maxY) };
}

function toPx(norm: number, size: number): number {
	return Math.round((Math.min(1000, Math.max(0, norm)) / 1000) * size);
}

async function releaseExistingSession(deviceId: string): Promise<void> {
	const existing = openByDeviceId.get(deviceId);
	if (!existing) return;
	openByDeviceId.delete(deviceId);
	try {
		await existing.quit();
	} catch (error) {
		console.warn(
			"[yoqa-runner] quit prior Device Session for exclusivity:",
			error instanceof Error ? error.message : error,
		);
	}
}

function defaultAppFor(platform: DevicePlatform): string {
	return platform === "ios" ? "com.apple.Preferences" : "com.android.settings";
}

function openTarget(options: SessionOptions): string {
	if (options.platform === "ios") return options.bundleId?.trim() || defaultAppFor("ios");
	return options.appPackage?.trim() || defaultAppFor("android");
}

function deviceSelectorArgs(options: SessionOptions): string[] {
	if (options.platform === "ios") return ["--udid", options.deviceId];
	return ["--serial", options.deviceId];
}

function isUnknownDeviceError(error: unknown): boolean {
	const code = error instanceof AgentDeviceError ? error.code : "";
	if (code === "DEVICE_NOT_FOUND" || code === "UNKNOWN_DEVICE") return true;
	const message = error instanceof Error ? error.message : String(error);
	return /no such device|device not found|unknown device|could not find device|ambiguous_match|ambiguous match/i.test(
		message,
	);
}

/** Close a leftover same-daemon session and retry once. */
export async function withDeviceInUseTakeover<T>(
	run: () => Promise<T>,
	closeSession: (address: string) => Promise<void> = async (address) => {
		await runAgentDevice(["close", "--session", address], { timeoutMs: 30_000 });
	},
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		const address = conflictingSessionAddress(error);
		if (!address) throw error;
		console.warn(`[yoqa-runner] device in use by ${address} — closing it`);
		await closeSession(address).catch(() => undefined);
		return await run();
	}
}

async function openAgentDeviceApp(
	sessionName: string,
	options: SessionOptions,
	target: string,
): Promise<void> {
	const base = ["open", target, "--platform", options.platform, "--session", sessionName];
	await withDeviceInUseTakeover(async () => {
		try {
			await runAgentDevice([...base, ...deviceSelectorArgs(options)], {
				timeoutMs: OPEN_TIMEOUT_MS,
			});
			return;
		} catch (error) {
			if (!isUnknownDeviceError(error)) throw error;
		}
		// Android ids may be AVD names rather than adb serials — retry by name.
		if (options.platform === "android") {
			await runAgentDevice([...base, "--device", options.deviceId], {
				timeoutMs: OPEN_TIMEOUT_MS,
			});
			return;
		}
		throw new Error(
			`Device not found: ${options.deviceId}. List devices with: yoqa devices ${options.platform}`,
		);
	});
}

class ActionGate {
	private locked = false;
	private pointer: { startX: number; startY: number; endX: number; endY: number } | null = null;

	isPointerActive(): boolean {
		return this.pointer != null;
	}

	async withLock<T>(fn: () => Promise<T>): Promise<T> {
		if (this.pointer) throw new Error("Device is busy with live pointer control");
		if (this.locked) throw new Error("Device is busy with another action");
		this.locked = true;
		try {
			return await fn();
		} finally {
			this.locked = false;
		}
	}

	begin(x: number, y: number): void {
		if (this.locked) throw new Error("Device is busy with another action");
		this.pointer = { startX: x, startY: y, endX: x, endY: y };
	}

	move(x: number, y: number): void {
		if (!this.pointer) throw new Error("No active pointer — send begin before move/end");
		this.pointer.endX = x;
		this.pointer.endY = y;
	}

	take(): { startX: number; startY: number; endX: number; endY: number } | null {
		const current = this.pointer;
		this.pointer = null;
		return current;
	}

	cancel(): void {
		this.pointer = null;
	}
}

/**
 * True when a failed open should trigger one check-and-install of
 * YoqaADRunner before retrying. The install needs a device kind to target
 * (devicectl vs simctl), so callers without one get the original error.
 */
export function shouldAutoInstallRunnerOnConnect(
	platform: DevicePlatform,
	kind: DeviceKind | undefined,
	error: unknown,
): boolean {
	if (platform !== "ios" || !kind) return false;
	return isRunnerNotInstalledError(error);
}

export async function createDeviceSession(options: SessionOptions): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	const sessionName = agentDeviceSessionName(options.deviceId);
	const closeSessionArgs = ["close", "--session", sessionName, ...deviceSelectorArgs(options)];
	// A previous runner process may have left the named session open — close it first.
	try {
		await runAgentDevice(closeSessionArgs, { timeoutMs: 30_000 });
	} catch {
		// No stale session — continue to open.
	}

	await openAgentDeviceApp(sessionName, options, openTarget(options)).catch(async (error) => {
		// Check-and-install is part of connect: a missing iOS runner is built
		// and installed once, then the open retries.
		const kind = options.kind;
		if (!kind || !shouldAutoInstallRunnerOnConnect(options.platform, kind, error)) {
			throw error;
		}
		await installYoqaRunnerOnDevice({ deviceId: options.deviceId, kind });
		await openAgentDeviceApp(sessionName, options, openTarget(options));
	});

	const gate = new ActionGate();
	let sessionDeadNotified = false;
	let cachedWindow: { width: number; height: number } | null = null;
	/** Live-feed frame cache: coalesces concurrent polls into one screenshot call. */
	const FRAME_CACHE_TTL_MS = 150;
	let frameCache: { at: number; frame: CapturedFrame } | null = null;
	let frameInFlight: Promise<CapturedFrame> | null = null;
	let lastApp: string | null = openTarget(options);

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
				if (!(error instanceof DeadSessionError)) {
					const message = error instanceof Error ? error.message : String(error);
					throw new DeadSessionError(message);
				}
			}
			throw error;
		}
	};

	const sessionArgs = (extra: string[]): string[] => [
		...extra,
		"--session",
		sessionName,
		...deviceSelectorArgs(options),
	];

	const snapshotNodes = async (): Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}> =>
		guard(async () => {
			const data = (await runAgentDevice(sessionArgs(["snapshot", "-i"]), {
				timeoutMs: 60_000,
			})) as { nodes?: SnapshotNode[] };
			const nodes = Array.isArray(data.nodes) ? data.nodes : [];
			const window = windowFromNodes(nodes, options.platform);
			cachedWindow = window;
			return { nodes, window };
		});

	const getWindowSize = async (): Promise<{ width: number; height: number }> => {
		if (cachedWindow) {
			// Validate the session is still alive with a cheap snapshot.
			try {
				const fresh = await snapshotNodes();
				return fresh.window;
			} catch (error) {
				if (isDeadSessionError(error)) throw error;
				return cachedWindow;
			}
		}
		const fresh = await snapshotNodes();
		return fresh.window;
	};

	const runAction = async (args: string[], timeoutMs = 60_000): Promise<void> => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runAgentDevice(sessionArgs(args), { timeoutMs });
			});
		});
	};

	const owned: { current: DeviceSession | null } = { current: null };

	const quit = async () => {
		if (openByDeviceId.get(options.deviceId) === owned.current) {
			openByDeviceId.delete(options.deviceId);
		}
		gate.cancel();
		if (sessionDeadNotified) return;
		try {
			await runAgentDevice(closeSessionArgs, { timeoutMs: 30_000 });
		} catch (error) {
			if (!isDeadSessionError(error)) {
				console.warn(
					"[yoqa-runner] close agent-device session failed:",
					error instanceof Error ? error.message : error,
				);
			}
		} finally {
			sessionDeadNotified = true;
		}
	};

	const captureFrame = async (): Promise<CapturedFrame> =>
		guard(async () => {
			const now = Date.now();
			// Coalesce concurrent live-feed polls within one TTL window so N
			// viewers share a single agent-device screenshot call.
			if (frameCache && now - frameCache.at < FRAME_CACHE_TTL_MS) {
				return frameCache.frame;
			}
			if (frameInFlight) {
				return frameInFlight;
			}
			frameInFlight = (async (): Promise<CapturedFrame> => {
				// --no-stabilize skips Android demo-mode/status-bar settling for
				// low-latency capture loops; persisted screenshots keep full quality.
				const path = join(tmpdir(), `yoqa-frame-${Date.now()}-${crypto.randomUUID()}.png`);
				const data = (await runAgentDevice(sessionArgs(["screenshot", path, "--no-stabilize"]), {
					timeoutMs: 60_000,
				})) as { path?: string; width?: number; height?: number };
				const filePath = typeof data.path === "string" && data.path ? data.path : path;
				if (typeof data.width === "number" && typeof data.height === "number") {
					cachedWindow = { width: data.width, height: data.height };
				}
				const bytes = await Bun.file(filePath).arrayBuffer();
				await rm(filePath, { force: true }).catch(() => undefined);
				return { base64: Buffer.from(bytes).toString("base64"), mime: "image/png" as const };
			})();
			try {
				const frame = await frameInFlight;
				frameCache = { at: Date.now(), frame };
				return frame;
			} finally {
				frameInFlight = null;
			}
		});

	const screenshot = async (): Promise<{ path: string; base64: string }> => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		const data = await guard(async () => {
			const result = (await runAgentDevice(sessionArgs(["screenshot", path]), {
				timeoutMs: 60_000,
			})) as { path?: string; width?: number; height?: number };
			return result;
		});
		if (typeof data.width === "number" && typeof data.height === "number") {
			cachedWindow = { width: data.width, height: data.height };
		}
		const bytes = await Bun.file(path).arrayBuffer();
		return { path, base64: Buffer.from(bytes).toString("base64") };
	};

	const tap = async (xNorm: number, yNorm: number, tapOptions?: { durationMs?: number }) => {
		const window = cachedWindow ?? (await getWindowSize());
		const x = toPx(xNorm, window.width);
		const y = toPx(yNorm, window.height);
		const holdMs = tapOptions?.durationMs;
		if (holdMs != null && holdMs >= 400) {
			await runAction(["longpress", String(x), String(y), String(Math.min(5000, holdMs))]);
			return;
		}
		const args =
			holdMs != null && holdMs > 50
				? ["press", String(x), String(y), "--hold-ms", String(Math.min(2000, holdMs))]
				: ["press", String(x), String(y)];
		await runAction(args);
	};

	const swipe = async (x1: number, y1: number, x2: number, y2: number, _durationMs = 400) => {
		const window = cachedWindow ?? (await getWindowSize());
		await runAction([
			"swipe",
			String(toPx(x1, window.width)),
			String(toPx(y1, window.height)),
			String(toPx(x2, window.width)),
			String(toPx(y2, window.height)),
		]);
	};

	const drag = async (x1: number, y1: number, x2: number, y2: number, durationMs = 800) => {
		const window = cachedWindow ?? (await getWindowSize());
		const startX = toPx(x1, window.width);
		const startY = toPx(y1, window.height);
		const dx = toPx(x2, window.width) - startX;
		const dy = toPx(y2, window.height) - startY;
		try {
			await runAction([
				"gesture",
				"pan",
				String(startX),
				String(startY),
				String(dx),
				String(dy),
				String(Math.min(5000, Math.max(100, durationMs))),
			]);
		} catch {
			await runAction([
				"swipe",
				String(startX),
				String(startY),
				String(startX + dx),
				String(startY + dy),
			]);
		}
	};

	const type = async (text: string) => {
		await runAction(["type", text]);
	};

	const activateApp = async (appId: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await openAgentDeviceApp(sessionName, options, appId);
				lastApp = appId;
			});
		});
	};

	const terminateApp = async (appId: string) => {
		await runAction(["close", appId]);
	};

	const backgroundApp = async (seconds = 3) => {
		await runAction(["home"]);
		await Bun.sleep(Math.min(30_000, Math.max(0, seconds * 1000)));
		if (lastApp) {
			try {
				await guard(async () => {
					await openAgentDeviceApp(sessionName, options, lastApp as string);
				});
			} catch (error) {
				console.warn(
					"[yoqa-runner] re-foreground after background failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}
	};

	const openUrl = async (url: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runAgentDevice(
					[
						"open",
						url,
						"--platform",
						options.platform,
						"--session",
						sessionName,
						...deviceSelectorArgs(options),
					],
					{ timeoutMs: OPEN_TIMEOUT_MS },
				);
			});
		});
	};

	const acceptAlert = async () => {
		await runAction(["alert", "accept"]);
	};

	const dismissAlert = async () => {
		await runAction(["alert", "dismiss"]);
	};

	const back = async () => {
		await runAction(["back"]);
	};

	const scroll = async (direction: "up" | "down" | "left" | "right", amount?: number) => {
		const args = ["scroll", direction];
		if (amount != null && Number.isFinite(amount) && amount > 0) {
			args.push(String(Math.min(0.8, amount)));
		}
		await runAction(args);
	};

	const home = async () => {
		await runAction(["home"]);
	};

	const keyboard = async (action: "dismiss" | "enter") => {
		await runAction(["keyboard", action]);
	};

	const pointerEvent = async (
		phase: PointerPhase,
		xNorm: number,
		yNorm: number,
		seq: number,
	): Promise<void> => {
		void seq;
		const window = cachedWindow ?? defaultWindowFor(options.platform);
		const x = toPx(xNorm, window.width);
		const y = toPx(yNorm, window.height);
		if (phase === "begin") {
			gate.begin(x, y);
			return;
		}
		if (phase === "move") {
			gate.move(x, y);
			return;
		}
		const gesture = gate.take();
		if (!gesture) throw new Error("No active pointer — send begin before move/end");
		const distance = Math.hypot(gesture.endX - x, gesture.endY - y);
		void distance;
		const total = Math.hypot(x - gesture.startX, y - gesture.startY);
		await guard(async () => {
			if (total < 12) {
				await runAgentDevice(sessionArgs(["press", String(x), String(y)]), {
					timeoutMs: 60_000,
				});
			} else {
				await runAgentDevice(
					sessionArgs([
						"swipe",
						String(gesture.startX),
						String(gesture.startY),
						String(x),
						String(y),
					]),
					{ timeoutMs: 60_000 },
				);
			}
		});
	};

	const session: DeviceSession = {
		quit,
		captureFrame,
		screenshot,
		snapshotNodes,
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
		back,
		scroll,
		home,
		keyboard,
		withActionLock: <T>(fn: () => Promise<T>) => gate.withLock(fn),
		pointerEvent,
		isPointerActive: () => gate.isPointerActive(),
	};
	owned.current = session;

	// Warm the window cache so first taps don't pay for a snapshot.
	try {
		await snapshotNodes();
	} catch {
		// Session is open; snapshot failures surface on first use.
	}

	openByDeviceId.set(options.deviceId, session);
	return session;
}
