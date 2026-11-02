import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import type {
	ActiveDeviceResponse,
	ConnectDeviceRequest,
	Device,
	DevicePlatform,
	ResetWebProfileRequest,
	ResetWebProfileResponse,
	RetargetDeviceRequest,
} from "@yoqa/runner-client";

export async function getActiveDevice(): Promise<ActiveDeviceResponse | null> {
	const client = await getRunnerClient();
	return client.getActiveDevice();
}

/** A platform's devices, with the ones listed but not usable (the picker says why). */
export async function listPlatformDevices(platform: DevicePlatform): Promise<Device[]> {
	const client = await getRunnerClient();
	const response = await client.listDevices(platform, { includeUnavailable: true });
	return response.devices;
}

/** Every platform's devices, for naming a Run's device whatever it ran on. */
export async function listAllDevices(): Promise<Device[]> {
	const [ios, android, web] = await Promise.all([
		listPlatformDevices("ios"),
		listPlatformDevices("android"),
		listPlatformDevices("web"),
	]);
	return [...ios, ...android, ...web];
}

/** Connect a device; `signal` cancels it, as while an Everyday browser waits for Allow. */
export async function connectDevice(
	request: ConnectDeviceRequest,
	options: { signal?: AbortSignal } = {},
): Promise<ActiveDeviceResponse> {
	const client = await getRunnerClient();
	return client.connectDevice(request, options);
}

/**
 * Open `chrome://inspect/#remote-debugging` in the Everyday browser `browserId` names, so
 * the user can turn remote debugging on. Rejects with the host's reason when it could not.
 */
export async function openRemoteDebuggingSetting(browserId: string): Promise<void> {
	const result = await getDesktopRpc().request.openRemoteDebuggingSetting({ browserId });
	if (!result.ok) throw new Error(result.error);
}

/**
 * Bring the Everyday browser `browserId` names to the front, so the user sees its Allow
 * prompt. Never rejects: a browser left behind is no reason to fail the connect, so the
 * host's reason only goes to the console.
 */
export async function bringEverydayBrowserToFront(browserId: string): Promise<void> {
	try {
		const result = await getDesktopRpc().request.bringEverydayBrowserToFront({ browserId });
		if (!result.ok) console.warn(`Could not bring ${browserId} to the front: ${result.error}`);
	} catch (error) {
		console.warn(`Could not bring ${browserId} to the front:`, error);
	}
}

/**
 * Delete a browser's Kept profile for an App, so its next connect starts signed out. The
 * runner refuses (409) while a browser has that profile open.
 */
export async function resetBrowserProfile(
	request: ResetWebProfileRequest,
): Promise<ResetWebProfileResponse> {
	const client = await getRunnerClient();
	return client.resetWebProfile(request);
}

export async function disconnectDevice(): Promise<void> {
	const client = await getRunnerClient();
	await client.disconnectDevice();
}

export async function retargetDevice(
	request: RetargetDeviceRequest,
): Promise<ActiveDeviceResponse> {
	const client = await getRunnerClient();
	return client.retargetDevice(request);
}
