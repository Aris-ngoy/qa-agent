export type SigningTier = "Paid" | "Personal";

export type XcodeInstallation = {
	id: string;
	appPath: string;
	appName: string;
	version: string;
	developerDir: string;
	isSelected: boolean;
};

export type SigningIdentity = {
	id: string;
	hash: string;
	name: string;
	teamId: string;
	organization: string;
	tier: SigningTier;
	/** Display label shown in the Settings select: "{teamId} {name}" */
	label: string;
};

export type IosToolchainPreferences = {
	xcodeDeveloperDir: string | null;
	signingIdentityHash: string | null;
};

export type IosToolchainSnapshot = {
	xcodes: XcodeInstallation[];
	identities: SigningIdentity[];
	preferences: IosToolchainPreferences;
};
