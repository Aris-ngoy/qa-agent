import type { DevicePlatform } from "@yoqa/runner-client";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import {
	type DeviceSession,
	createDeviceSession,
	isDeadSessionError,
	onDeviceSessionExclusiveRelease,
} from "./session";

export type ActiveSessionInfo = {
	deviceId: string;
	platform: DevicePlatform;
	connectedAt: number;
	mjpegPort: number;
	streamReady: boolean;
	/** Relative path on the runner for the MJPEG proxy. */
	streamUrl: string;
};

type ActiveSession = ActiveSessionInfo & {
	session: DeviceSession;
};

let active: ActiveSession | null = null;

/** Compat alias — prefer `isDeadSessionError` from `./session`. */
export const isMissingAppiumSessionError = isDeadSessionError;

export function getActiveSession(): ActiveSession | null {
	return active;
}

export function getActiveSessionInfo(): ActiveSessionInfo | null {
	if (!active) return null;
	return {
		deviceId: active.deviceId,
		platform: active.platform,
		connectedAt: active.connectedAt,
		mjpegPort: active.mjpegPort,
		streamReady: active.streamReady,
		streamUrl: active.streamUrl,
	};
}

export function requireActiveSession(): ActiveSession {
	if (!active) {
		throw new Error("No active device session. Run: yoqa devices connect <device_id>");
	}
	return active;
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

/** When exclusivity releases this device's session (e.g. a Run took it), clear the Active Session singleton. */
onDeviceSessionExclusiveRelease((deviceId) => {
	if (active?.deviceId === deviceId) {
		abandonActiveSession();
	}
});

export async function connectDevice(options: {
	deviceId: string;
	platform: DevicePlatform;
	bundleId?: string;
	appPackage?: string;
}): Promise<ActiveSessionInfo> {
	if (active) {
		await disconnectDevice();
	}

	const session = await createDeviceSession({
		platform: options.platform,
		deviceId: options.deviceId,
		appCaps: [],
		caseCaps: [],
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
	};

	const info = getActiveSessionInfo();
	if (!info) {
		throw new Error("Failed to read active session after connect");
	}
	return info;
}

export async function disconnectDevice(): Promise<ActiveSessionInfo | null> {
	if (!active) return null;
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
