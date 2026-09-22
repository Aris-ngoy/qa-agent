import type { DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import { type ArgentSessionOptions, createArgentDeviceSession } from "../argent/session";
import { isDeadArgentSessionError } from "../argent/session";

/** Stable error for a Device Session the backend has already dropped. */
export class DeadSessionError extends Error {
	constructor(message = "Device session ended") {
		super(message);
		this.name = "DeadSessionError";
	}
}

/** True when Argent reports the session is gone (Dead Session). */
export function isDeadSessionError(error: unknown): boolean {
	if (error instanceof DeadSessionError) return true;
	if (isDeadArgentSessionError(error)) return true;
	const message = error instanceof Error ? error.message : String(error);
	return /session does not exist|invalid session|no such session|no active device session|no active session|session.+not found|terminated or not started|session is either terminated/i.test(
		message,
	);
}

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	/** Physical vs simulator — informational under Argent (it manages its own runner). */
	kind?: DeviceKind;
	bundleId?: string;
	appPackage?: string;
	/** Android launch activity — passed as `launch-app --activity` when set. */
	activity?: string;
	/** Called once when Argent reports the session is gone. */
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
	/**
	 * In-memory frame for live feed / grounding — never persists under runs/.
	 * Within `FRAME_CACHE_TTL_MS` concurrent callers share one capture;
	 * pass `{ fresh: true }` (stream pump) to always capture a new frame.
	 */
	captureFrame: (options?: { fresh?: boolean }) => Promise<CapturedFrame>;
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
	/**
	 * Clean terminate+relaunch. Present on Argent-backed sessions
	 * (`restart-app`); callers must feature-check before use.
	 */
	restartApp?: (appId: string) => Promise<void>;
	backgroundApp: (seconds?: number) => Promise<void>;
	openUrl: (url: string) => Promise<void>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
	/** System back navigation (`button back`; unsupported on iOS). */
	back: () => Promise<void>;
	/** Semantic scroll (center-based deterministic swipes). */
	scroll: (direction: "up" | "down" | "left" | "right", amount?: number) => Promise<void>;
	/** Bare home-screen press (`button home`; no sleep/reopen unlike backgroundApp). */
	home: () => Promise<void>;
	/** Device keyboard control (`keyboard --key escape|enter`). */
	keyboard: (action: "dismiss" | "enter") => Promise<void>;
	/** Run an exclusive device action (blocks live pointer + other actions). */
	withActionLock: <T>(fn: () => Promise<T>) => Promise<T>;
	pointerEvent: (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => Promise<void>;
	isPointerActive: () => boolean;
};

function toArgentOptions(options: SessionOptions): ArgentSessionOptions {
	return {
		platform: options.platform,
		deviceId: options.deviceId,
		kind: options.kind,
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		activity: options.activity,
		onSessionDead: options.onSessionDead,
	};
}

/**
 * Create a Device Session via the Argent backend (the only device backend).
 * Argent manages its own runner and tool-server: no named sessions, no
 * same-daemon steal path, no check-and-install — the per-device registry
 * lives in the Argent adapter.
 */
export async function createDeviceSession(options: SessionOptions): Promise<DeviceSession> {
	const session = await createArgentDeviceSession(toArgentOptions(options));
	return session as unknown as DeviceSession;
}
