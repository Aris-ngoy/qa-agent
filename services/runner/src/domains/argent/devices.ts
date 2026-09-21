import type { Device, DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import { runArgentTool } from "./cli";

type ArgentListItem = {
	platform?: string;
	os?: string;
	id?: string;
	udid?: string;
	serial?: string;
	name?: string;
	kind?: string;
	type?: string;
	state?: string;
	status?: string;
	booted?: boolean;
	connected?: boolean;
};

function platformOf(item: ArgentListItem, fallback: DevicePlatform): DevicePlatform {
	const raw = `${item.platform ?? ""} ${item.os ?? ""}`.toLowerCase();
	if (raw.includes("ios") || raw.includes("apple") || raw.includes("tvos")) return "ios";
	if (raw.includes("android") || raw.includes("vega") || raw.includes("fire")) return "android";
	return fallback;
}

function mapKind(item: ArgentListItem, platform: DevicePlatform): DeviceKind {
	const kind = `${item.kind ?? ""} ${item.type ?? ""}`.toLowerCase();
	if (kind.includes("simulator") || kind.includes("sim")) return "simulator";
	if (kind.includes("emulator") || kind.includes("avd")) return "emulator";
	if (kind.includes("device") || kind.includes("physical")) return "physical";
	return platform === "ios" ? "simulator" : "emulator";
}

function mapState(item: ArgentListItem, kind: DeviceKind): string {
	if (typeof item.booted === "boolean") {
		if (item.booted) return kind === "simulator" ? "Booted" : "online";
		return kind === "simulator" ? "Shutdown" : "offline";
	}
	if (typeof item.connected === "boolean") {
		if (item.connected) return kind === "physical" ? "connected" : "online";
		return kind === "physical" ? "paired" : "offline";
	}
	const raw = `${item.state ?? ""} ${item.status ?? ""}`.toLowerCase().trim();
	if (!raw) return "unknown";
	if (raw.includes("booted")) return "Booted";
	if (raw.includes("shutdown")) return "Shutdown";
	if (raw.includes("connected") || raw.includes("online")) {
		return kind === "simulator" ? "Booted" : "online";
	}
	if (raw.includes("paired") || raw.includes("offline")) {
		return kind === "simulator" ? "Shutdown" : "offline";
	}
	return item.state?.trim() || item.status?.trim() || "unknown";
}

function toDevice(item: ArgentListItem, fallbackPlatform: DevicePlatform): Device | null {
	const id = (item.id ?? item.udid ?? item.serial ?? "").trim();
	const name = (item.name ?? "").trim();
	if (!id || !name) return null;
	const platform = platformOf(item, fallbackPlatform);
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

function extractItems(data: unknown): ArgentListItem[] {
	if (Array.isArray(data)) return data as ArgentListItem[];
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		for (const key of ["devices", "items", "simulators", "data"]) {
			if (Array.isArray(record[key])) return record[key] as ArgentListItem[];
		}
	}
	return [];
}

/**
 * List devices via `argent run list-devices`.
 * Argent has no OS-version field, so Yoqa reports a generic platform label.
 * Visual-first: listing never captures screenshots.
 */
export async function listArgentDevices(
	platform: DevicePlatform,
	options: { includeUnavailable?: boolean } = {},
): Promise<Device[]> {
	const data = await runArgentTool("list-devices", { platform });
	const items = extractItems(data);
	const devices: Device[] = [];
	for (const item of items) {
		if (typeof item !== "object" || item === null) continue;
		const device = toDevice(item as ArgentListItem, platform);
		if (!device) continue;
		if (device.platform !== platform) continue;
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
