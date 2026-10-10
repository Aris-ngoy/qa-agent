import type { Capability, DevicePlatform } from "@yoqa/runner-client";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import { hasCustomCapabilities } from "./select-lane";
import { type DeviceSession, createDeviceSession, isDeadSessionError } from "./session";

export type ActiveSessionInfo = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	/** Port of the live MJPEG broadcaster, when the Lane offers one. */
	mjpegPort?: number;
	streamReady: boolean;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
	/** A Run currently owns this session for test execution (interactive actions are view-only). */
	heldByRun: boolean;
	/** The id of the Run that holds this session, while one does. */
	heldByRunId?: string;
	lane: import("./lane").LaneName;
	laneWarning?: string;
};

type ActiveSession = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
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
		mjpegPort: current.session.stream?.port,
		streamReady: current.session.stream?.ready ?? false,
		streamUrl: current.streamUrl,
		heldByRun: current.heldByRunId != null,
		...(current.heldByRunId != null ? { heldByRunId: current.heldByRunId } : {}),
		lane: current.session.lane,
		...(current.session.laneWarning ? { laneWarning: current.session.laneWarning } : {}),
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
	requestedLane?: import("./lane").LaneName | "auto";
	heldByRunId: string | null;
}): Promise<DeviceSession> {
	const session = await createDeviceSession({
		platform: options.platform,
		deviceId: options.deviceId,
		appCaps: options.appCaps ?? [],
		caseCaps: options.caseCaps ?? [],
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		requestedLane: options.requestedLane,
		onSessionDead: () => {
			abandonActiveSession();
		},
	});

	active = {
		deviceId: options.deviceId,
		platform: options.platform,
		connectedAt: Date.now(),
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
	appCaps?: Capability[];
	caseCaps?: Capability[];
	requestedLane?: import("./lane").LaneName | "auto";
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
 * Point the Active Session at another app (the user switched app) without reconnecting
 * or launching anything. The app id the session's platform uses is picked from the two.
 * Refused while a Run holds the session: the Run decides which app it reads.
 */
export function retargetActiveSession(app: {
	bundleId?: string;
	appPackage?: string;
}): ActiveSessionInfo {
	const current = requireActiveSession();
	if (current.heldByRunId != null) {
		throw new SessionBusyError(
			"A run is using the device session. Wait for it to finish before switching app.",
		);
	}
	current.session.setTargetApp(targetAppFor({ platform: current.platform, ...app }));
	return toInfo(current);
}

/**
 * Run-side acquisition of the shared Device Session.
 *
 * - Adopts the Active Session when it already targets the requested device
 *   (no reconnect, no WDA relaunch) and marks it held by this run, whatever its
 *   Lane — unless the Run's App or first Case sets custom Appium capabilities and
 *   the session is not on the Appium lane. Then the session is replaced with an
 *   Appium session and the Run carries a Lane warning saying why (ADR-0004).
 * - Replaces an unheld Active Session pointing at another device (device change).
 * - Opens a fresh session on the Run's requested Lane when there is none to adopt.
 * - When another run owns the shared session, creates a detached session that
 *   is not registered as Active and is quit again at release. A held session on
 *   the same device is never replaced: that request fails with `SessionBusyError`.
 */
export async function acquireSessionForRun(options: {
	runId: string;
	deviceId: string;
	platform: DevicePlatform;
	appCaps?: Capability[];
	caseCaps?: Capability[];
	bundleId?: string;
	appPackage?: string;
	requestedLane?: import("./lane").LaneName | "auto";
}): Promise<{ session: DeviceSession; shared: boolean }> {
	const current = active;

	if (current?.heldByRunId && current.heldByRunId !== options.runId) {
		if (current.deviceId === options.deviceId) {
			throw new SessionBusyError(
				`Another run is using ${options.deviceId}. Wait for it to finish or cancel it first.`,
			);
		}
		const session = await createDeviceSession({
			platform: options.platform,
			deviceId: options.deviceId,
			appCaps: options.appCaps ?? [],
			caseCaps: options.caseCaps ?? [],
			bundleId: options.bundleId,
			appPackage: options.appPackage,
			requestedLane: options.requestedLane,
			onSessionDead: () => undefined,
		});
		return { session, shared: false };
	}

	let replacedWarning: string | undefined;
	if (current && current.deviceId === options.deviceId) {
		const pinned =
			current.session.lane !== "appium" &&
			hasCustomCapabilities(options.appCaps ?? [], options.caseCaps ?? []);
		if (pinned) {
			replacedWarning = `Custom Appium capabilities pin the Appium lane; replaced the ${laneLabel(current.session.lane)} Active Session`;
			console.warn(`[yoqa-runner] ${replacedWarning} for ${options.deviceId}`);
		} else {
			// Health-check before adopting: a stale session (device restarted,
			// Appium dropped it) must not fail the whole run.
			const healthy = await current.session
				.getWindowSize()
				.then(() => true)
				.catch(() => false);
			if (healthy) {
				current.heldByRunId = options.runId;
				// The session may have been opened for another app; the Run reads its own.
				current.session.setTargetApp(targetAppFor(options));
				return { session: current.session, shared: true };
			}
			console.warn(
				`[yoqa-runner] active session for ${options.deviceId} is dead — creating a fresh one for the run`,
			);
		}
		await disconnectDevice().catch(() => undefined);
	}

	if (active) {
		await disconnectDevice();
	}

	const session = await createAndRegister({
		deviceId: options.deviceId,
		platform: options.platform,
		appCaps: options.appCaps,
		caseCaps: options.caseCaps,
		bundleId: options.bundleId,
		appPackage: options.appPackage,
		requestedLane: options.requestedLane,
		heldByRunId: options.runId,
	});
	if (replacedWarning) {
		// The replacement reason already says capabilities pin Appium; keep any other warning.
		const others = session.laneWarning?.split("; ").filter((w) => !replacedWarning?.startsWith(w));
		session.laneWarning = [replacedWarning, ...(others ?? [])].join("; ");
	}
	return { session, shared: true };
}

/** The app id a session on this platform targets: the iOS bundle id or the Android package. */
function targetAppFor(options: {
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
}): string | undefined {
	return options.platform === "ios" ? options.bundleId : options.appPackage;
}

function laneLabel(lane: import("./lane").LaneName): string {
	return lane === "direct" ? "Direct" : "Appium";
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
