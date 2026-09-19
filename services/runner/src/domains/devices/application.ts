import type { Device } from "@yoqa/runner-client";
import { listAgentDevices } from "../agent-device/devices";
import type { ListDevicesOptions } from "./models";

export async function listIosDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listAgentDevices("ios", options);
}

export async function listAndroidDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listAgentDevices("android", options);
}

export async function listDevices(
	platform: "ios" | "android",
	options: ListDevicesOptions = {},
): Promise<Device[]> {
	return listAgentDevices(platform, options);
}
