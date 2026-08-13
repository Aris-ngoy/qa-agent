export type AndroidPathSource =
	| "env"
	| "android-studio"
	| "platform-default"
	| "java_home"
	| "unset";

export type DetectedAndroidPath = {
	path: string | null;
	source: AndroidPathSource;
	exists: boolean;
};

export type AndroidToolchainPreferences = {
	/** Custom SDK root. `null` means use the detected system path. */
	sdkRoot: string | null;
	/** Custom JAVA_HOME. `null` means use the detected system path. */
	javaHome: string | null;
};

export type AndroidToolchainSnapshot = {
	detected: {
		sdkRoot: DetectedAndroidPath;
		javaHome: DetectedAndroidPath;
	};
	preferences: AndroidToolchainPreferences;
	effective: {
		sdkRoot: string | null;
		javaHome: string | null;
		sdkRootExists: boolean;
		javaHomeExists: boolean;
	};
};
