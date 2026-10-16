import { type DevicePlatform, devicePlatformSchema } from "@yoqa/runner-client";

/** What `yoqa devices <platform>` lists, per platform. */
export const PLATFORM_DEVICES_DESCRIPTION: Record<DevicePlatform, string> = {
	ios: "List iOS devices and simulators",
	android: "List Android devices and emulators",
	web: "List web browsers (attach a Chromium you started by naming its port: chromium-cdp-<port>)",
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

/**
 * The platform `yoqa devices connect` opens: `--platform` when given, else web for a
 * user-started Chromium named by its debug port (`chromium-cdp-9222`).
 */
export function connectPlatform(deviceId: string, value: string | undefined): DevicePlatform {
	if (value === undefined && /^chromium-cdp-\d+$/.test(deviceId)) return "web";
	return parsePlatform(value);
}
