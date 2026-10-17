import { getRunnerClient } from "@/app/runner-client";
import type {
	ActiveDeviceResponse,
	ConnectDeviceRequest,
	Device,
	DevicePlatform,
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

export async function connectDevice(request: ConnectDeviceRequest): Promise<ActiveDeviceResponse> {
	const client = await getRunnerClient();
	return client.connectDevice(request);
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
