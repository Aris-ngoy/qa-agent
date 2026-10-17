import type { DevicePlatform, SelectedDevice } from "@/features/devices/data/state/session-bar";
import { attachedBrowser, viewportFor } from "@/features/devices/utils/web-device";
import {
	DEFAULT_VIEWPORT_PRESET,
	type Device,
	type ViewportPresetName,
	devicePlatformSchema,
	viewportPresetSchema,
} from "@yoqa/runner-client";

/** The device the session bar connected last, kept across launches, with a browser's preset. */
export type RememberedDevice = {
	platform: DevicePlatform;
	deviceId: string;
	viewport?: ViewportPresetName;
};

type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

const REMEMBERED_DEVICE_KEY = "yoqa.lastDevice";

/** A listed device as the bar shows and connects it, named the way the picker names it. */
function toSelectedDevice(device: Device, viewport?: ViewportPresetName): SelectedDevice {
	const preset = viewportFor(device.platform, viewport);
	return {
		id: device.id,
		label: device.owner ? `${device.name} (${device.owner})` : device.name,
		name: device.name,
		osVersion: device.osVersion,
		platform: device.platform,
		kind: device.kind,
		...(preset ? { viewport: preset } : {}),
	};
}

/**
 * The Active Session's device by its real name and kind, from the platform's device list,
 * at the session's Viewport preset. Null when the list does not have it (or has not
 * loaded): its kind is then unknown. An attached browser is never listed, so it is named
 * from its port.
 */
export function deviceForSession(
	session: { deviceId: string; platform: DevicePlatform; viewport?: ViewportPresetName },
	devices: readonly Device[] | undefined,
): SelectedDevice | null {
	if (session.platform === "web") {
		const attached = attachedBrowser(session.deviceId, session.viewport ?? DEFAULT_VIEWPORT_PRESET);
		if (attached) return attached;
	}
	const listed = devices?.find(
		(device) => device.id === session.deviceId && device.platform === session.platform,
	);
	return listed ? toSelectedDevice(listed, session.viewport) : null;
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
	return listed ? toSelectedDevice(listed, remembered.viewport) : null;
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
		const platform = devicePlatformSchema.safeParse(parsed.platform);
		if (!platform.success) return null;
		if (typeof parsed.deviceId !== "string" || parsed.deviceId.length === 0) return null;
		const viewport = viewportPresetSchema.safeParse(parsed.viewport);
		return {
			platform: platform.data,
			deviceId: parsed.deviceId,
			...(viewport.success ? { viewport: viewport.data } : {}),
		};
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
			JSON.stringify({
				platform: device.platform,
				deviceId: device.deviceId,
				...(device.viewport ? { viewport: device.viewport } : {}),
			}),
		);
	} catch {
		// ignore storage failures in restricted webviews
	}
}
