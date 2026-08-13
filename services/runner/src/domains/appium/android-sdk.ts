import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AndroidSdkEnv = {
	ANDROID_HOME?: string;
	ANDROID_SDK_ROOT?: string;
	JAVA_HOME?: string;
	PATH?: string;
};

export type AndroidSdkPatch = {
	ANDROID_HOME?: string;
	ANDROID_SDK_ROOT?: string;
	JAVA_HOME?: string;
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

export function defaultJavaHomeCandidates(
	home: string,
	platform: NodeJS.Platform = process.platform,
): string[] {
	if (platform === "darwin") {
		return [
			join("/Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
			join(home, "Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
		];
	}
	if (platform === "linux") {
		return [
			join(home, "android-studio", "jbr"),
			"/opt/android-studio/jbr",
			"/usr/local/android-studio/jbr",
		];
	}
	return [];
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
		pathExists: (path: string) => boolean;
	},
): AndroidSdkPatch {
	const patch: AndroidSdkPatch = {};
	const resolved = resolveAndroidSdkRoot(env, options);
	if (resolved && options.pathExists(resolved)) {
		patch.PATH = pathWithAndroidSdk(env.PATH ?? "", resolved);
		if (!env.ANDROID_HOME?.trim() && !env.ANDROID_SDK_ROOT?.trim()) {
			patch.ANDROID_HOME = resolved;
			patch.ANDROID_SDK_ROOT = resolved;
		}
	}
	if (!env.JAVA_HOME?.trim()) {
		for (const candidate of defaultJavaHomeCandidates(options.home, options.platform)) {
			if (options.pathExists(candidate)) {
				patch.JAVA_HOME = candidate;
				break;
			}
		}
	}
	return patch;
}

function envRecord(env: NodeJS.ProcessEnv): Record<string, string> {
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") next[key] = value;
	}
	return next;
}

function applyPatch(env: Record<string, string>, patch: AndroidSdkPatch): Record<string, string> {
	if (patch.ANDROID_HOME) env.ANDROID_HOME = patch.ANDROID_HOME;
	if (patch.ANDROID_SDK_ROOT) env.ANDROID_SDK_ROOT = patch.ANDROID_SDK_ROOT;
	if (patch.JAVA_HOME) env.JAVA_HOME = patch.JAVA_HOME;
	if (patch.PATH) env.PATH = patch.PATH;
	return env;
}

/** Full env for Appium / adb child processes, with GUI SDK and JDK fallbacks. */
export function androidProcessEnv(
	env: NodeJS.ProcessEnv = process.env,
	options?: {
		home?: string;
		platform?: NodeJS.Platform;
		pathExists?: (path: string) => boolean;
	},
): Record<string, string> {
	const next = envRecord(env);
	const patch = androidSdkEnvPatch(
		{
			ANDROID_HOME: next.ANDROID_HOME,
			ANDROID_SDK_ROOT: next.ANDROID_SDK_ROOT,
			JAVA_HOME: next.JAVA_HOME,
			PATH: next.PATH,
		},
		{
			home: options?.home ?? homedir(),
			platform: options?.platform ?? process.platform,
			localAppData: next.LOCALAPPDATA,
			pathExists: options?.pathExists ?? existsSync,
		},
	);
	return applyPatch(next, patch);
}

/** Mutates `process.env` so later probes (adb, doctor) see the same SDK / JDK. */
export function ensureAndroidSdkEnv(): void {
	const next = androidProcessEnv(process.env);
	if (next.ANDROID_HOME) process.env.ANDROID_HOME = next.ANDROID_HOME;
	if (next.ANDROID_SDK_ROOT) process.env.ANDROID_SDK_ROOT = next.ANDROID_SDK_ROOT;
	if (next.JAVA_HOME) process.env.JAVA_HOME = next.JAVA_HOME;
	if (next.PATH) process.env.PATH = next.PATH;
}
