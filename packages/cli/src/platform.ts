import {
	type DevicePlatform,
	VIEWPORT_PRESET_NAMES,
	type ViewportPresetName,
	devicePlatformSchema,
} from "@yoqa/runner-client";

/** What `yoqa devices <platform>` lists, per platform. */
export const PLATFORM_DEVICES_DESCRIPTION: Record<DevicePlatform, string> = {
	ios: "List iOS devices and simulators",
	android: "List Android devices and emulators",
	web: "List installed web browsers and your Everyday browsers (CI: attach a Chromium you started by naming its port, chromium-cdp-<port>)",
};

/** A `--platform` value, or an error naming the platforms the CLI takes. */
export function parsePlatform(value: string | undefined): DevicePlatform {
	const parsed = devicePlatformSchema.safeParse(value);
	if (!parsed.success) {
		const names = devicePlatformSchema.options.map((option) => option.value);
		throw new Error(`--platform must be ${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);
	}
	return parsed.data;
}

/** A web device id: an installed browser (`web-chrome`) or a user-started Chromium's port. */
const WEB_DEVICE_ID = /^(web-(chrome|edge|brave|chromium)|chromium-cdp-\d+)$/;

/** Each Everyday browser's device id, and the browser its Allow prompt appears in. */
const EVERYDAY_BROWSER_NAMES = new Map([
	["web-chrome-everyday", "Google Chrome"],
	["web-edge-everyday", "Microsoft Edge"],
	["web-brave-everyday", "Brave Browser"],
	["web-chromium-everyday", "Chromium"],
	["web-dia-everyday", "Dia"],
]);

/** The browser an Everyday browser's device id names (`Google Chrome`), or null. */
export function everydayBrowserName(deviceId: string): string | null {
	return EVERYDAY_BROWSER_NAMES.get(deviceId) ?? null;
}

/** An Everyday browser's device id: the user's own browser, used only when named. */
export function isEverydayDeviceId(deviceId: string): boolean {
	return everydayBrowserName(deviceId) !== null;
}

/** Whether a device id names a web device, whose platform needs no `--platform`. */
export function isWebDeviceId(deviceId: string): boolean {
	return WEB_DEVICE_ID.test(deviceId) || isEverydayDeviceId(deviceId);
}

/**
 * The platform `yoqa devices connect` opens: `--platform` when given, else web for an
 * installed browser (`web-chrome`) or a user-started Chromium named by its debug port
 * (`chromium-cdp-9222`).
 */
export function connectPlatform(deviceId: string, value: string | undefined): DevicePlatform {
	if (value === undefined && isWebDeviceId(deviceId)) return "web";
	return parsePlatform(value);
}

/**
 * A `--viewport` value in any case, for a web connect only. Undefined leaves the preset to
 * the runner, which opens desktop.
 */
export function parseViewportPreset(
	value: string | undefined,
	platform: DevicePlatform,
): ViewportPresetName | undefined {
	if (value === undefined) return undefined;
	if (platform !== "web") {
		throw new Error("--viewport is for web devices: a phone's screen is its own size");
	}
	const preset = VIEWPORT_PRESET_NAMES.find((name) => name === value.trim().toLowerCase());
	if (!preset) throw new Error(`--viewport must be ${VIEWPORT_PRESET_NAMES.join(" or ")}`);
	return preset;
}
