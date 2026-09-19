import type { Device, DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import { runAgentDevice } from "./cli";

type AgentDeviceListItem = {
	platform?: string;
	id?: string;
	name?: string;
	kind?: string;
	target?: string;
	booted?: boolean;
};

function mapKind(item: AgentDeviceListItem, platform: DevicePlatform): DeviceKind {
	const kind = item.kind?.toLowerCase() ?? "";
	if (kind.includes("emulator")) return "emulator";
	if (kind.includes("simulator")) return "simulator";
	if (kind.includes("physical") || kind.includes("device")) return "physical";
	// agent-device reports simulators on iOS and emulators on Android;
	// fall back per platform when the kind string is unexpected.
	return platform === "ios" ? "simulator" : "emulator";
}

function mapState(item: AgentDeviceListItem, kind: DeviceKind): string {
	if (item.booted === true) return kind === "simulator" ? "Booted" : "online";
	if (item.booted === false) return kind === "simulator" ? "Shutdown" : "offline";
	return "unknown";
}

function toDevice(item: AgentDeviceListItem, platform: DevicePlatform): Device | null {
	const id = item.id?.trim();
	const name = item.name?.trim();
	if (!id || !name) return null;
	const kind = mapKind(item, platform);
	return {
		id,
		name,
		osVersion: platform === "ios" ? "iOS" : "Android",
		platform,
		kind,
		state: mapState(item, kind),
		model: undefined,
	};
}

/**
 * List devices via `agent-device devices --platform <ios|android> --json`.
 * agent-device has no OS-version field, so Yoqa reports a generic platform label.
 */
export async function listAgentDevices(
	platform: DevicePlatform,
	options: { includeUnavailable?: boolean } = {},
): Promise<Device[]> {
	const data = (await runAgentDevice(["devices", "--platform", platform])) as {
		devices?: AgentDeviceListItem[];
	};
	const items = Array.isArray(data.devices) ? data.devices : [];
	const devices: Device[] = [];
	for (const item of items) {
		if (typeof item !== "object" || item === null) continue;
		const device = toDevice(item as AgentDeviceListItem, platform);
		if (!device) continue;
		if (!(options.includeUnavailable ?? true)) {
			const state = device.state?.toLowerCase() ?? "";
			const available =
				state === "booted" || state === "online" || state === "connected" || state === "device";
			if (!available) continue;
		}
		devices.push(device);
	}
	devices.sort((a, b) => {
		const aLive = a.state === "Booted" || a.state === "online" ? 0 : 1;
		const bLive = b.state === "Booted" || b.state === "online" ? 0 : 1;
		if (aLive !== bLive) return aLive - bLive;
		return a.name.localeCompare(b.name);
	});
	return devices;
}
