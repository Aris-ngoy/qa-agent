import type { DevicePlatform } from "@yoqa/runner-client";
import { type DeviceSession, createDeviceSession } from "../runs/session";

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

/** Appium/WDA session vanished while the runner still held a handle. */
export function isMissingAppiumSessionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /session does not exist|invalid session id|no such session|terminated or not started|session is either terminated/i.test(
		message,
	);
}

/**
 * Drop the in-memory active session without calling deleteSession
 * (the remote session is already gone).
 */
export function abandonActiveSession(): ActiveSessionInfo | null {
	if (!active) return null;
	const info = getActiveSessionInfo();
	active = null;
	console.warn(
		`[yoqa-runner] abandoned dead Appium session for ${info?.platform} ${info?.deviceId}`,
	);
	return info;
}

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
	try {
		await active.session.quit();
	} catch {
		// ignore
	}
	active = null;
	return info;
}
