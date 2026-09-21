import type { Device } from "@yoqa/runner-client";
import { listAgentDevices } from "../agent-device/devices";
import { listArgentDevices } from "../argent/devices";
import type { ListDevicesOptions } from "./models";

export async function listIosDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listDevices("ios", options);
}

export async function listAndroidDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	return listDevices("android", options);
}

export async function listDevices(
	platform: "ios" | "android",
	options: ListDevicesOptions = {},
): Promise<Device[]> {
	try {
		return await listArgentDevices(platform, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/TOOL_MISSING|CONSENT_REQUIRED|ARGENT_NOT_INSTALLED/i.test(message)) {
			return listAgentDevices(platform, options);
		}
		// Argent present but listing failed (e.g. server down) — fall back so
		// existing sessions keep working during the migration.
		try {
			return await listAgentDevices(platform, options);
		} catch {
			throw error;
		}
	}
}
