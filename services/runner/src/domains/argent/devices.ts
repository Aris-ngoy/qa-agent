import type { Device, DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import { runArgentTool } from "./cli";

type ArgentListEntry = {
	platform?: unknown;
	udid?: unknown;
	serial?: unknown;
	id?: unknown;
	name?: unknown;
	kind?: unknown;
	state?: unknown;
	runtime?: unknown;
	model?: unknown;
};

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapKind(entry: ArgentListEntry, platform: DevicePlatform): DeviceKind {
	const kind = asString(entry.kind)?.toLowerCase() ?? "";
	if (kind.includes("emulator")) return "emulator";
	if (kind.includes("simulator")) return "simulator";
	if (kind.includes("physical") || kind === "device") return "physical";
	// iOS sims carry no kind; Android entries without one are emulators.
	return platform === "ios" ? "simulator" : "emulator";
}

/** Human OS label from Argent's runtime string (`…iOS-26-2`, `iOS 26.2 (physical device)`). */
function mapOsVersion(entry: ArgentListEntry, platform: DevicePlatform): string {
	const runtime = asString(entry.runtime) ?? "";
	const simMatch = runtime.match(/iOS[-_ ](\d+)[-_ ](\d+)/i);
	if (simMatch?.[1] != null && simMatch?.[2] != null) return `iOS ${simMatch[1]}.${simMatch[2]}`;
	const deviceMatch = runtime.match(/(iOS\s+\d[\d.]*|Android\s+\d[\d.]*)/i);
	if (deviceMatch?.[1] != null) return deviceMatch[1].trim();
	return platform === "ios" ? "iOS" : "Android";
}

function toDevice(entry: ArgentListEntry, platform: DevicePlatform): Device | null {
	const id = asString(entry.udid) ?? asString(entry.serial) ?? asString(entry.id);
	const name = asString(entry.name);
	if (!id || !name) return null;
	return {
		id,
		name,
		osVersion: mapOsVersion(entry, platform),
		platform,
		kind: mapKind(entry, platform),
		state: asString(entry.state) ?? "unknown",
		model: asString(entry.model) ?? undefined,
	};
}

function isAvailable(state: string): boolean {
	const normalized = state.toLowerCase();
	return (
		normalized === "booted" ||
		normalized === "connected" ||
		normalized === "online" ||
		normalized === "running" ||
		normalized === "device"
	);
}

/**
 * List devices via `argent run list-devices` (udid/serial, kind
 * emulator/device, booted-first). Non-phone platforms (chromium, vega, tv)
 * are dropped — parity is iOS sim/device + Android emu/device only.
 */
export async function listArgentDevices(
	platform: DevicePlatform,
	options: { includeUnavailable?: boolean } = {},
): Promise<Device[]> {
	const data = (await runArgentTool("list-devices", [], { timeoutMs: 60_000 })) as {
		devices?: unknown;
	};
	const raw = Array.isArray(data?.devices) ? (data.devices as unknown[]) : [];
	const devices: Device[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as ArgentListEntry;
		if (entry.platform !== platform) continue;
		const device = toDevice(entry, platform);
		if (!device) continue;
		if (!(options.includeUnavailable ?? true) && !isAvailable(device.state ?? "")) continue;
		devices.push(device);
	}
	devices.sort((a, b) => {
		const aLive = isAvailable(a.state ?? "") ? 0 : 1;
		const bLive = isAvailable(b.state ?? "") ? 0 : 1;
		if (aLive !== bLive) return aLive - bLive;
		return a.name.localeCompare(b.name);
	});
	return devices;
}
