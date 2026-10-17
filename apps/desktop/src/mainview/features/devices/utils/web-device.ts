import type { SelectedDevice } from "@/features/devices/components/select-device-modal";
import {
	DEFAULT_VIEWPORT_PRESET,
	type Device,
	type DevicePlatform,
	VIEWPORT_PRESETS,
	type ViewportPresetName,
} from "@yoqa/runner-client";

const ATTACH_ID = /^chromium-cdp-(\d{1,5})$/;

function portOf(value: string): number | null {
	if (!/^\d{1,5}$/.test(value)) return null;
	const port = Number(value);
	return port >= 1 && port <= 65_535 ? port : null;
}

/**
 * The device id of a Chromium the user started with `--remote-debugging-port`, named by
 * that port (`chromium-cdp-9222`). Null when the value is not a port.
 */
export function attachDeviceId(port: string): string | null {
	const parsed = portOf(port.trim());
	return parsed == null ? null : `chromium-cdp-${parsed}`;
}

/**
 * An attached browser as the bar shows and connects it. It is never listed (ports are
 * not scanned), so the bar names it from its id. Null for an id that names no port.
 */
export function attachedBrowser(
	deviceId: string,
	viewport: ViewportPresetName,
): SelectedDevice | null {
	const port = portOf(ATTACH_ID.exec(deviceId)?.[1] ?? "");
	if (port == null) return null;
	const name = `Chromium on port ${port}`;
	return {
		id: deviceId,
		label: name,
		name,
		osVersion: `port ${port}`,
		platform: "web",
		kind: "browser",
		viewport,
	};
}

/** The installed browsers in a device list: the picker's Browsers tab. */
export function browserDevices(devices: readonly Device[]): Device[] {
	return devices.filter((device) => device.kind === "browser");
}

/** The Viewport preset a connect on `platform` names: web only, desktop by default. */
export function viewportFor(
	platform: DevicePlatform,
	viewport: ViewportPresetName | undefined,
): ViewportPresetName | undefined {
	return platform === "web" ? (viewport ?? DEFAULT_VIEWPORT_PRESET) : undefined;
}

/** `Google Chrome · mobile`: a browser's label with its preset. A phone's stays as it is. */
export function withViewport(
	label: string,
	platform: DevicePlatform,
	viewport: ViewportPresetName | undefined,
): string {
	return platform === "web" && viewport ? `${label} · ${viewport}` : label;
}

/**
 * The CSS aspect ratio of a web page's frame, its preset's size. Null on a phone, which
 * keeps its phone-shaped frame.
 */
export function screenAspect(
	platform: DevicePlatform,
	viewport: ViewportPresetName | undefined,
): string | null {
	if (platform !== "web") return null;
	const { width, height } = VIEWPORT_PRESETS[viewport ?? DEFAULT_VIEWPORT_PRESET];
	return `${width} / ${height}`;
}
