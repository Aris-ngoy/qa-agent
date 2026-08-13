import { join } from "node:path";
import type { DetectedAndroidPath } from "../../../shared/android-toolchain";

export function defaultAndroidSdkRoot(
	home: string,
	platform: NodeJS.Platform,
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

export function defaultJavaHomeCandidates(home: string, platform: NodeJS.Platform): string[] {
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

/** Persist `null` when the field is empty or matches the live system path. */
export function normalizePathOverride(value: string, detected: string | null): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (detected && trimmed === detected) return null;
	return trimmed;
}

export function effectivePath(override: string | null, detected: string | null): string | null {
	const custom = override?.trim();
	if (custom) return custom;
	return detected;
}

export function detectSdkRoot(options: {
	env: { ANDROID_HOME?: string; ANDROID_SDK_ROOT?: string };
	home: string;
	platform: NodeJS.Platform;
	localAppData?: string;
	pathExists: (path: string) => boolean;
}): DetectedAndroidPath {
	const fromEnv = options.env.ANDROID_HOME?.trim() || options.env.ANDROID_SDK_ROOT?.trim();
	if (fromEnv) {
		return { path: fromEnv, source: "env", exists: options.pathExists(fromEnv) };
	}
	const fallback = defaultAndroidSdkRoot(options.home, options.platform, options.localAppData);
	return {
		path: fallback,
		source: "platform-default",
		exists: options.pathExists(fallback),
	};
}

export function detectJavaHome(options: {
	env: { JAVA_HOME?: string };
	home: string;
	platform: NodeJS.Platform;
	pathExists: (path: string) => boolean;
	javaHomeFromTool?: string | null;
}): DetectedAndroidPath {
	const fromEnv = options.env.JAVA_HOME?.trim();
	if (fromEnv) {
		return { path: fromEnv, source: "env", exists: options.pathExists(fromEnv) };
	}
	for (const candidate of defaultJavaHomeCandidates(options.home, options.platform)) {
		if (options.pathExists(candidate)) {
			return { path: candidate, source: "android-studio", exists: true };
		}
	}
	const fromTool = options.javaHomeFromTool?.trim();
	if (fromTool) {
		return { path: fromTool, source: "java_home", exists: options.pathExists(fromTool) };
	}
	return { path: null, source: "unset", exists: false };
}
