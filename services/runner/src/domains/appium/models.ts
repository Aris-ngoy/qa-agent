import type { DevicePlatform } from "@yoqa/runner-client";

export type AppiumDriverName = "xcuitest" | "uiautomator2";

export type ResolvedAppium = {
	/** Absolute path to the appium binary or entry script */
	bin: string;
	version: string;
	/** Whether this came from PATH vs managed ~/.yoqa/runtime */
	source: "system" | "managed";
	/** Env vars to pass when invoking appium (e.g. APPIUM_HOME for managed) */
	env: Record<string, string>;
	/** Working directory for appium/npm (avoids parent package.json pickup) */
	cwd?: string;
	/** When true, invoke via `node <bin>` (managed index.js entry) */
	invokeViaNode: boolean;
};

export type PlatformSetupResult = {
	ok: true;
	platform: DevicePlatform;
	driver: AppiumDriverName;
	appiumVersion: string;
	driverVersion?: string;
	alreadyInstalled: boolean;
	message: string;
};

export type RuntimeCheckId =
	| "node"
	| "npm"
	| "appium"
	| "xcuitest"
	| "uiautomator2"
	| "xcode"
	| "adb";

export type RuntimeCheck = {
	id: RuntimeCheckId;
	label: string;
	ok: boolean;
	required: boolean;
	detail?: string;
};

export type RuntimeStatus = {
	ready: boolean;
	appiumVersion?: string;
	appiumSource?: "system" | "managed";
	checks: RuntimeCheck[];
};

export type RuntimeEnsureResult = {
	ok: true;
	ready: boolean;
	status: RuntimeStatus;
	installed: PlatformSetupResult[];
	message: string;
};

export function driverForPlatform(platform: DevicePlatform): AppiumDriverName {
	return platform === "ios" ? "xcuitest" : "uiautomator2";
}

/** Pinned Appium version for managed installs under ~/.yoqa/runtime */
export const MANAGED_APPIUM_VERSION = "3.5.2";

/** Driver versions peer-compatible with MANAGED_APPIUM_VERSION */
export const MANAGED_DRIVER_VERSIONS: Record<AppiumDriverName, string> = {
	xcuitest: "11.17.7",
	uiautomator2: "8.1.0",
};
