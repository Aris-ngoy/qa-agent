import type { Device } from "@yoqa/runner-client";
import { listArgentDevices } from "../argent/devices";
import type { ListDevicesOptions } from "./models";

export async function listIosDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listArgentDevices("ios", options);
}

export async function listAndroidDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listArgentDevices("android", options);
}

export async function listDevices(
	platform: "ios" | "android",
	options: ListDevicesOptions = {},
): Promise<Device[]> {
	return listArgentDevices(platform, options);
}
