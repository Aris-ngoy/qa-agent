export type XcodeInstallation = {
	id: string;
	appPath: string;
	appName: string;
	version: string;
	developerDir: string;
	isSelected: boolean;
};

export type IosToolchainPreferences = {
	xcodeDeveloperDir: string | null;
};

export type IosToolchainSnapshot = {
	xcodes: XcodeInstallation[];
	preferences: IosToolchainPreferences;
};
