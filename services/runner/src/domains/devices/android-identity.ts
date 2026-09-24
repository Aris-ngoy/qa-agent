/** Connected Android device as Appium sees it: ADB serial, optional AVD name. */
export type ConnectedAndroidDevice = {
	serial: string;
	avdName: string | null;
};

export type AndroidAppiumIdentity = {
	/** ADB serial for `appium:udid`. Omitted when the target is an AVD that is not running. */
	udid?: string;
	/** AVD name for `appium:avd` so Appium can attach or launch the emulator. */
	avd?: string;
};

/**
 * Map a Yoqa Android device id to Appium capabilities.
 *
 * Device list uses the AVD name as the stable id for emulators (`Pixel_10`),
 * but UiAutomator2 only accepts ADB serials (`emulator-5554`) as `appium:udid`.
 */
export function matchAndroidAppiumIdentity(
	deviceId: string,
	connected: ConnectedAndroidDevice[],
	knownAvds: string[] = [],
): AndroidAppiumIdentity {
	const id = deviceId.trim();
	if (!id) return {};

	const bySerial = connected.find((device) => device.serial === id);
	if (bySerial) {
		return {
			udid: bySerial.serial,
			...(bySerial.avdName ? { avd: bySerial.avdName } : {}),
		};
	}

	const byAvd = connected.find((device) => device.avdName === id);
	if (byAvd) {
		return { udid: byAvd.serial, avd: byAvd.avdName ?? id };
	}

	if (knownAvds.includes(id)) {
		return { avd: id };
	}

	return { udid: id };
}

/** Parse `adb emu avd name` stdout (`Pixel_10\\nOK` or empty on console-auth failure). */
export function parseAdbEmuAvdName(stdout: string): string | null {
	const name = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && line !== "OK");
	return name || null;
}
