import type { Device, DeviceKind, DevicePlatform } from "@yoqa/runner-client";

export type { Device, DeviceKind, DevicePlatform };

export type ListDevicesOptions = {
	/** When false, omit shutdown / offline virtual devices. Default true. */
	includeUnavailable?: boolean;
};
