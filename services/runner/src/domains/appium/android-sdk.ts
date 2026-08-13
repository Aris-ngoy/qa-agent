import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AndroidSdkEnv = {
	ANDROID_HOME?: string;
	ANDROID_SDK_ROOT?: string;
	PATH?: string;
};

export type AndroidSdkPatch = {
	ANDROID_HOME?: string;
	ANDROID_SDK_ROOT?: string;
	PATH?: string;
};

/**
 * Platform default SDK root (Android Studio). Used only when neither
 * ANDROID_HOME nor ANDROID_SDK_ROOT is exported — typical for macOS GUI apps.
 */
export function defaultAndroidSdkRoot(
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
	localAppData?: string,
): string {
	if (platform === "win32") {
		const base = localAppData || join(home, "AppData", "Local");
		return join(base, "Android", "Sdk");
	}
	if (platform === "darwin") {
		return join(home, "Library", "Android", "sdk");
	}
	return join(home, "Android", "Sdk");
}

/** Prefer exported ANDROID_HOME, then ANDROID_SDK_ROOT, then the platform default. */
export function resolveAndroidSdkRoot(
	env: AndroidSdkEnv = {
		ANDROID_HOME: process.env.ANDROID_HOME,
		ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
	},
	options?: { home?: string; platform?: NodeJS.Platform; localAppData?: string },
): string | null {
	const fromEnv = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim();
	if (fromEnv) return fromEnv;
	const home = options?.home ?? homedir();
	const platform = options?.platform ?? process.platform;
	return defaultAndroidSdkRoot(home, platform, options?.localAppData);
}

export function androidSdkBinDirs(sdkRoot: string): string[] {
	return [
		join(sdkRoot, "platform-tools"),
		join(sdkRoot, "cmdline-tools", "latest", "bin"),
		join(sdkRoot, "emulator"),
	];
}

export function pathWithAndroidSdk(currentPath: string, sdkRoot: string): string {
	const extras = androidSdkBinDirs(sdkRoot);
	const existing = currentPath.split(":").filter(Boolean);
	const prepend = extras.filter((dir) => !existing.includes(dir));
	return [...prepend, ...existing].join(":");
}

/**
 * Env vars Appium UiAutomator2 needs. Empty when the SDK directory is missing
 * so we do not export a bogus ANDROID_HOME.
 */
export function androidSdkEnvPatch(
	env: AndroidSdkEnv,
	options: {
		home: string;
		platform: NodeJS.Platform;
		localAppData?: string;
		sdkExists: (path: string) => boolean;
	},
): AndroidSdkPatch {
	const resolved = resolveAndroidSdkRoot(env, options);
	if (!resolved || !options.sdkExists(resolved)) return {};

	const patch: AndroidSdkPatch = {
		PATH: pathWithAndroidSdk(env.PATH ?? "", resolved),
	};
	if (!env.ANDROID_HOME?.trim() && !env.ANDROID_SDK_ROOT?.trim()) {
		patch.ANDROID_HOME = resolved;
		patch.ANDROID_SDK_ROOT = resolved;
	}
	return patch;
}

let androidSdkEnvReady = false;

/** Idempotent — mutates `process.env` once per process for GUI launches. */
export function ensureAndroidSdkEnv(): void {
	if (androidSdkEnvReady) return;
	androidSdkEnvReady = true;
	const patch = androidSdkEnvPatch(
		{
			ANDROID_HOME: process.env.ANDROID_HOME,
			ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
			PATH: process.env.PATH,
		},
		{
			home: homedir(),
			platform: process.platform,
			localAppData: process.env.LOCALAPPDATA,
			sdkExists: existsSync,
		},
	);
	if (patch.ANDROID_HOME) process.env.ANDROID_HOME = patch.ANDROID_HOME;
	if (patch.ANDROID_SDK_ROOT) process.env.ANDROID_SDK_ROOT = patch.ANDROID_SDK_ROOT;
	if (patch.PATH) process.env.PATH = patch.PATH;
}

/** Test-only: allow re-applying after env is reset. */
export function resetAndroidSdkEnvForTests(): void {
	androidSdkEnvReady = false;
}
