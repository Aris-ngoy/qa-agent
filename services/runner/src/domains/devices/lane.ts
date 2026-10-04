import type { Capability, DevicePlatform } from "@yoqa/runner-client";

/**
 * The control path a Device Session uses (see `Lane` in CONTEXT.md and ADR-0004).
 * `appium` is always registered. `direct` is registered for Android (adb).
 */
export type LaneName = "appium" | "direct";

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	appCaps: Capability[];
	caseCaps: Capability[];
	bundleId?: string;
	appPackage?: string;
	/** User-requested Lane. `auto` (default) picks Direct when that factory exists. */
	requestedLane?: LaneName | "auto";
	/** Called once when the lane reports the session is gone. */
	onSessionDead?: () => void;
};

export type CapturedFrame = {
	base64: string;
	mime: "image/png" | "image/jpeg";
};

export type PointerPhase = "begin" | "move" | "end";

/**
 * A live MJPEG feed of the device screen that the runner proxies to the Inspector.
 * A lane that cannot offer one reports `stream: null`; the Inspector then polls screenshots.
 */
export type LiveStream = {
	/** The broadcaster answered at connect time. When false, callers must not proxy it. */
	ready: boolean;
	/** Local port the broadcaster listens on. */
	port: number;
	/** URL the runner fetches the MJPEG feed from. */
	upstreamUrl: string;
};

export type DeviceSession = {
	/** Which Lane drives this session. Fixed for the session's whole life. */
	lane: LaneName;
	/** Why this session is not on the requested Lane, when it fell back or was pinned. */
	laneWarning?: string;
	stream: LiveStream | null;
	quit: () => Promise<void>;
	/** In-memory frame for live feed / grounding — never writes disk. */
	captureFrame: () => Promise<CapturedFrame>;
	/** Persist a screenshot under ~/.yoqa/runs/screenshots/. */
	screenshot: () => Promise<{ path: string; base64: string }>;
	pageSource: () => Promise<string>;
	getWindowSize: () => Promise<{ width: number; height: number }>;
	tap: (
		xNorm: number,
		yNorm: number,
		options?: { durationMs?: number; coordSpace?: "window" | "screenshot" },
	) => Promise<void>;
	swipe: (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		durationMs?: number,
		options?: { coordSpace?: "window" | "screenshot" },
	) => Promise<void>;
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

/**
 * Opens a Device Session on one Lane. It does not enforce per-device exclusivity;
 * `createDeviceSession` does, so every lane shares the same rule (ADR-0001).
 */
export type LaneFactory = (options: SessionOptions) => Promise<DeviceSession>;

const DEAD_SESSION_RE =
	/session does not exist|invalid session id|no such session|terminated or not started|session is either terminated/i;

/** Stable error for a Device Session the lane has already dropped. */
export class DeadSessionError extends Error {
	constructor(message = "Device session ended") {
		super(message);
		this.name = "DeadSessionError";
	}
}

/** True when the lane reports the session is gone (Dead Session). */
export function isDeadSessionError(error: unknown): boolean {
	if (error instanceof DeadSessionError) return true;
	const message = error instanceof Error ? error.message : String(error);
	return DEAD_SESSION_RE.test(message);
}
