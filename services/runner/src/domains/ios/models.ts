/** Base reverse-DNS prefix; prefer {@link wdaBundleIdForTeam} for installs. */
export const WDA_BUNDLE_ID = "io.yoqa.WebDriverAgentRunner";

/** Team-scoped bundle id (matches noqa): keeps provisioning/signing isolated per team. */
export function wdaBundleIdForTeam(developmentTeam: string): string {
	const team = developmentTeam.trim();
	if (!team) return WDA_BUNDLE_ID;
	return `${WDA_BUNDLE_ID}.${team}`;
}

export type IosWdaInstallParams = {
	deviceId: string;
	xcodeDeveloperDir: string;
	developmentTeam: string;
	codeSignIdentity: string;
	/** Override APPIUM_HOME when resolving the bundled WDA project */
	appiumHome?: string;
};

export type IosWdaInstallResult = {
	ok: true;
	bundleId: string;
	appPath: string;
	derivedDataPath: string;
	deviceId: string;
};

export type DevicePrepRecord = {
	deviceId: string;
	platform: "ios";
	bundleId: string;
	appPath: string;
	derivedDataPath: string;
	developmentTeam: string;
	codeSignIdentity: string;
	xcodeDeveloperDir: string;
	installedAt: string;
};
