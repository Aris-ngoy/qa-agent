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

/**
 * The Active Session's device by its real name and kind, from the platform's device list.
 * Null when the list does not have it (or has not loaded): its kind is then unknown.
 */
export function deviceForSession(
	session: { deviceId: string; platform: DevicePlatform },
	devices: readonly Device[] | undefined,
): SelectedDevice | null {
	const listed = devices?.find(
		(device) => device.id === session.deviceId && device.platform === session.platform,
	);
	return listed ? toSelectedDevice(listed) : null;
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
