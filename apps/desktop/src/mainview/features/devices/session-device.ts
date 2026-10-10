import type { Device } from "@yoqa/runner-client";
import type { DevicePlatform, SelectedDevice } from "./select-device-modal";

/** The device the session bar connected last, kept across launches. */
export type RememberedDevice = { platform: DevicePlatform; deviceId: string };

type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

const REMEMBERED_DEVICE_KEY = "yoqa.lastDevice";

/** A listed device as the bar shows and connects it, named the way the picker names it. */
function toSelectedDevice(device: Device): SelectedDevice {
	return {
		id: device.id,
		label: device.owner ? `${device.name} (${device.owner})` : device.name,
		name: device.name,
		osVersion: device.osVersion,
		platform: device.platform,
		kind: device.kind,
	};
}

/** A simulator's UDID is a UUID; a physical iPhone's is not. Android emulators are `emulator-*`. */
function guessKind(platform: DevicePlatform, deviceId: string): SelectedDevice["kind"] {
	if (platform === "android") return deviceId.startsWith("emulator-") ? "emulator" : "physical";
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)
		? "simulator"
		: "physical";
}

/**
 * The Active Session's device by its real name and kind, from the platform's device list.
 * A device the list does not have is shown by its id.
 */
export function deviceForSession(
	session: { deviceId: string; platform: DevicePlatform },
	devices: readonly Device[] | undefined,
): SelectedDevice {
	const listed = devices?.find((device) => device.id === session.deviceId);
	if (listed) return toSelectedDevice(listed);
	return {
		id: session.deviceId,
		label: session.deviceId,
		name: session.deviceId,
		osVersion: "",
		platform: session.platform,
		kind: guessKind(session.platform, session.deviceId),
	};
}

/**
 * The remembered device to preselect, when the device list still has it and it can be
 * picked; otherwise nothing, so the bar asks for a device.
 */
export function pickRememberedDevice(
	remembered: RememberedDevice | null,
	devices: readonly Device[] | undefined,
): SelectedDevice | null {
	if (!remembered) return null;
	const listed = devices?.find(
		(device) =>
			device.id === remembered.deviceId &&
			device.platform === remembered.platform &&
			!device.unavailableReason,
	);
	return listed ? toSelectedDevice(listed) : null;
}

function defaultStorage(): DeviceStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function readRememberedDevice(
	storage: DeviceStorage | null = defaultStorage(),
): RememberedDevice | null {
	try {
		const raw = storage?.getItem(REMEMBERED_DEVICE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<RememberedDevice>;
		if (parsed.platform !== "ios" && parsed.platform !== "android") return null;
		if (typeof parsed.deviceId !== "string" || parsed.deviceId.length === 0) return null;
		return { platform: parsed.platform, deviceId: parsed.deviceId };
	} catch {
		return null;
	}
}

export function writeRememberedDevice(
	device: RememberedDevice,
	storage: DeviceStorage | null = defaultStorage(),
): void {
	try {
		storage?.setItem(
			REMEMBERED_DEVICE_KEY,
			JSON.stringify({ platform: device.platform, deviceId: device.deviceId }),
		);
	} catch {
		// ignore storage failures in restricted webviews
	}
}
