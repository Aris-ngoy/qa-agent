import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type {
	AndroidToolchainPreferences,
	AndroidToolchainSnapshot,
} from "../../../shared/android-toolchain";
import { patchStoredSettings, readStoredSettings } from "../app-settings/store";
import { detectJavaHome, detectSdkRoot, effectivePath, normalizePathOverride } from "./detect";

async function javaHomeFromTool(): Promise<string | null> {
	if (process.platform !== "darwin") return null;
	try {
		const proc = Bun.spawn(["/usr/libexec/java_home"], { stdout: "pipe", stderr: "pipe" });
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0) return null;
		const path = stdout.trim().split("\n")[0]?.trim();
		return path || null;
	} catch {
		return null;
	}
}

function readPreferencesFromStore(
	stored: Awaited<ReturnType<typeof readStoredSettings>>,
): AndroidToolchainPreferences {
	return {
		sdkRoot: stored.android?.sdkRoot ?? null,
		javaHome: stored.android?.javaHome ?? null,
	};
}

export async function getAndroidToolchainSnapshot(): Promise<AndroidToolchainSnapshot> {
	const stored = await readStoredSettings();
	const preferences = readPreferencesFromStore(stored);
	const home = homedir();
	const sdkRoot = detectSdkRoot({
		env: process.env,
		home,
		platform: process.platform,
		localAppData: process.env.LOCALAPPDATA,
		pathExists: existsSync,
	});
	const javaHome = detectJavaHome({
		env: process.env,
		home,
		platform: process.platform,
		pathExists: existsSync,
		javaHomeFromTool: await javaHomeFromTool(),
	});

	const sdkEffective = effectivePath(preferences.sdkRoot, sdkRoot.path);
	const javaEffective = effectivePath(preferences.javaHome, javaHome.path);

	return {
		detected: { sdkRoot, javaHome },
		preferences,
		effective: {
			sdkRoot: sdkEffective,
			javaHome: javaEffective,
			sdkRootExists: Boolean(sdkEffective && existsSync(sdkEffective)),
			javaHomeExists: Boolean(javaEffective && existsSync(javaEffective)),
		},
	};
}

export async function setAndroidToolchainSelection(params: {
	sdkRoot?: string | null;
	javaHome?: string | null;
}): Promise<AndroidToolchainSnapshot> {
	const current = await getAndroidToolchainSnapshot();
	const next: AndroidToolchainPreferences = {
		sdkRoot:
			params.sdkRoot === undefined
				? current.preferences.sdkRoot
				: normalizePathOverride(params.sdkRoot ?? "", current.detected.sdkRoot.path),
		javaHome:
			params.javaHome === undefined
				? current.preferences.javaHome
				: normalizePathOverride(params.javaHome ?? "", current.detected.javaHome.path),
	};
	await patchStoredSettings({ android: next });
	return getAndroidToolchainSnapshot();
}

/** Env injected into the runner sidecar so Appium sees SDK / JDK paths. */
export async function androidToolchainProcessEnv(): Promise<Record<string, string>> {
	const snapshot = await getAndroidToolchainSnapshot();
	const env: Record<string, string> = {};
	if (snapshot.effective.sdkRoot) {
		env.ANDROID_HOME = snapshot.effective.sdkRoot;
		env.ANDROID_SDK_ROOT = snapshot.effective.sdkRoot;
	}
	if (snapshot.effective.javaHome) {
		env.JAVA_HOME = snapshot.effective.javaHome;
	}
	return env;
}
