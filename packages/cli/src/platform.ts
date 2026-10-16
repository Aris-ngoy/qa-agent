import { type DevicePlatform, devicePlatformSchema } from "@yoqa/runner-client";

/** What `yoqa devices <platform>` lists, per platform. */
export const PLATFORM_DEVICES_DESCRIPTION: Record<DevicePlatform, string> = {
	ios: "List iOS devices and simulators",
	android: "List Android devices and emulators",
};

/** A `--platform` value, or an error naming the platforms the CLI takes. */
export function parsePlatform(value: string | undefined): DevicePlatform {
	const parsed = devicePlatformSchema.safeParse(value);
	if (!parsed.success) {
		const names = devicePlatformSchema.options.map((option) => option.value);
		throw new Error(`--platform must be ${names.join(" or ")}`);
	}
	return parsed.data;
}
