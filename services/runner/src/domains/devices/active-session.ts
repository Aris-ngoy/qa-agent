import type { Capability, DevicePlatform } from "@yoqa/runner-client";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import { type DeviceSession, createDeviceSession, isDeadSessionError } from "./session";

export type ActiveSessionInfo = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	mjpegPort: number;
	streamReady: boolean;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
	/** A Run currently owns this session for test execution (interactive actions are view-only). */
	heldByRun: boolean;
};

type ActiveSession = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	mjpegPort: number;
	streamReady: boolean;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
	session: DeviceSession;
	/** Run id currently executing on this session, when a Run owns it. */
	heldByRunId: string | null;
};

let active: ActiveSession | null = null;

/** The device session is in use by a Run and cannot be replaced or disconnected interactively. */
export class SessionBusyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionBusyError";
	}
}

/** Compat alias — prefer `isDeadSessionError` from `./session`. */
export const isMissingAppiumSessionError = isDeadSessionError;

function toInfo(current: ActiveSession): ActiveSessionInfo {
	return {
		deviceId: current.deviceId,
		platform: current.platform,
		connectedAt: current.connectedAt,
		mjpegPort: current.mjpegPort,
		streamReady: current.streamReady,
		streamUrl: current.streamUrl,
		heldByRun: current.heldByRunId != null,
	};
}

export function getActiveSession(): ActiveSession | null {
	return active;
}

export function getActiveSessionInfo(): ActiveSessionInfo | null {
	if (!active) return null;
	return toInfo(active);
}

export function requireActiveSession(): ActiveSession {
	if (!active) {
		throw new Error("No active device session. Run: yoqa devices connect <device_id>");
	}
	return active;
}

/** True while a Run owns the shared session (view-only interactive mode). */
export function isActiveSessionHeldByRun(): boolean {
	return active?.heldByRunId != null;
}

/**
 * Drop the in-memory active session without calling deleteSession
 * (the remote session is already gone).
 */
export function abandonActiveSession(): ActiveSessionInfo | null {
	if (!active) return null;
	const info = getActiveSessionInfo();
	active = null;
	abortAllMjpegProxies();
	console.warn(
		`[yoqa-runner] abandoned dead Appium session for ${info?.platform} ${info?.deviceId}`,
	);
	return info;
}

async function createAndRegister(options: {
	deviceId: string;
	platform: DevicePlatform;
	appCaps?: Capability[];
	caseCaps?: Capability[];
	bundleId?: string;
	appPackage?: string;
	heldByRunId: string | null;
}): Promise<DeviceSession> {
	const session = await createDeviceSession({
		platform: options.platform,
		deviceId: options.deviceId,
		appCaps: options.appCaps ?? [],
		caseCaps: options.caseCaps ?? [],
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		onSessionDead: () => {
			abandonActiveSession();
		},
	});

	active = {
		deviceId: options.deviceId,
		platform: options.platform,
		connectedAt: Date.now(),
		mjpegPort: session.mjpegPort,
		streamReady: session.streamReady,
		streamUrl: "/stream.mjpeg",
		session,
		heldByRunId: options.heldByRunId,
	};

	return session;
}

/**
 * Interactive connect (inspector / CLI). Replaces any existing session unless
 * a Run holds it — cancel the run first.
 */
export async function connectDevice(options: {
	deviceId: string;
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
}): Promise<ActiveSessionInfo> {
	if (isActiveSessionHeldByRun()) {
		throw new SessionBusyError(
			"A run is using the device session. Cancel the run before connecting another device.",
		);
	}
	if (active) {
		await disconnectDevice();
	}

	await createAndRegister({ ...options, heldByRunId: null });

	const info = getActiveSessionInfo();
	if (!info) {
		throw new Error("Failed to read active session after connect");
	}
	return info;
}

export async function disconnectDevice(): Promise<ActiveSessionInfo | null> {
	if (!active) return null;
	if (isActiveSessionHeldByRun()) {
		throw new SessionBusyError("A run is using the device session. Cancel the run first.");
	}
	const info = getActiveSessionInfo();
	const session = active.session;
	// Drop the handle first so new stream proxies refuse; then cut upstream
	// MJPEG so WebDriverAgentRunner can actually terminate on deleteSession.
	active = null;
	abortAllMjpegProxies();
	try {
		await session.quit();
	} catch {
		// ignore — timed out or already dead
	}
	return info;
}

/**
 * Run-side acquisition of the shared Device Session.
 *
 * - Adopts the Active Session when it already targets the requested device
 *   (no reconnect, no WDA relaunch) and marks it held by this run.
 * - Replaces an unheld Active Session pointing at another device (device change).
 * - When another run owns the shared session, creates a detached session that
 *   is not registered as Active and is quit again at release.
 */
export async function acquireSessionForRun(options: {
	runId: string;
	deviceId: string;
	platform: DevicePlatform;
	appCaps?: Capability[];
	caseCaps?: Capability[];
	bundleId?: string;
	appPackage?: string;
}): Promise<{ session: DeviceSession; shared: boolean }> {
	const current = active;

	if (current?.heldByRunId && current.heldByRunId !== options.runId) {
		const session = await createDeviceSession({
			platform: options.platform,
			deviceId: options.deviceId,
			appCaps: options.appCaps ?? [],
			caseCaps: options.caseCaps ?? [],
			bundleId: options.bundleId,
			appPackage: options.appPackage,
			onSessionDead: () => undefined,
		});
		return { session, shared: false };
	}

	if (current && current.deviceId === options.deviceId) {
		// Health-check before adopting: a stale session (device restarted,
		// Appium dropped it) must not fail the whole run.
		const healthy = await current.session
			.getWindowSize()
			.then(() => true)
			.catch(() => false);
		if (healthy) {
			current.heldByRunId = options.runId;
			return { session: current.session, shared: true };
		}
		console.warn(
			`[yoqa-runner] active session for ${options.deviceId} is dead — creating a fresh one for the run`,
		);
		await disconnectDevice().catch(() => undefined);
	}

	if (current) {
		await disconnectDevice();
	}

	const session = await createAndRegister({
		deviceId: options.deviceId,
		platform: options.platform,
		appCaps: options.appCaps,
		caseCaps: options.caseCaps,
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		heldByRunId: options.runId,
	});
	return { session, shared: true };
}

/**
 * Run-side release. A shared session stays live as the Active Session so the
 * user can inspect right after the run; a detached session is torn down.
 */
export async function releaseSessionFromRun(
	runId: string,
	session: DeviceSession,
	shared: boolean,
): Promise<void> {
	if (!shared) {
		await session.quit().catch(() => undefined);
		return;
	}
	if (active && active.heldByRunId === runId) {
		active.heldByRunId = null;
	}
}
