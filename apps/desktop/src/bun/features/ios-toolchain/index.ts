import { basename, join } from "node:path";
import type {
	IosToolchainPreferences,
	IosToolchainSnapshot,
	XcodeInstallation,
} from "../../../shared/ios-toolchain";
import { patchStoredSettings, readStoredSettings } from "../app-settings/store";

async function runCommand(
	command: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(command, {
		cwd: options?.cwd,
		env: options?.env ? { ...process.env, ...options.env } : process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

async function readPreferences(): Promise<IosToolchainPreferences> {
	const parsed = await readStoredSettings();
	return {
		xcodeDeveloperDir: parsed.ios?.xcodeDeveloperDir ?? null,
	};
}

async function writePreferences(prefs: IosToolchainPreferences): Promise<void> {
	await patchStoredSettings({ ios: prefs });
}

async function getXcodeSelectPath(): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["xcode-select", "-p"]);
	if (exitCode !== 0) return null;
	const path = stdout.trim();
	return path.length > 0 ? path : null;
}

async function discoverXcodeAppPaths(): Promise<string[]> {
	const found = new Set<string>();

	const { stdout } = await runCommand([
		"mdfind",
		"kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'",
	]);
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.endsWith(".app")) found.add(trimmed);
	}

	const glob = new Bun.Glob("Xcode*.app");
	for await (const match of glob.scan({ cwd: "/Applications", onlyFiles: false })) {
		found.add(join("/Applications", match));
	}

	return [...found].sort();
}

async function readXcodeVersion(appPath: string): Promise<string> {
	const { stdout, exitCode } = await runCommand([
		"defaults",
		"read",
		join(appPath, "Contents/Info"),
		"CFBundleShortVersionString",
	]);
	if (exitCode === 0 && stdout.trim()) return stdout.trim();

	const xcodebuild = join(appPath, "Contents/Developer/usr/bin/xcodebuild");
	const version = await runCommand([xcodebuild, "-version"]);
	const match = version.stdout.match(/Xcode\s+([^\s]+)/);
	return match?.[1] ?? "unknown";
}

function developerDirForApp(appPath: string): string {
	return join(appPath, "Contents/Developer");
}

async function listXcodeInstallations(
	preferredDeveloperDir: string | null,
): Promise<XcodeInstallation[]> {
	const selectedPath = await getXcodeSelectPath();
	const appPaths = await discoverXcodeAppPaths();

	const installations = await Promise.all(
		appPaths.map(async (appPath) => {
			const developerDir = developerDirForApp(appPath);
			const version = await readXcodeVersion(appPath);
			const appName = basename(appPath);
			return {
				id: developerDir,
				appPath,
				appName,
				version,
				developerDir,
				isSelected: false,
			} satisfies XcodeInstallation;
		}),
	);

	const preferred =
		(preferredDeveloperDir &&
			installations.find((item) => item.developerDir === preferredDeveloperDir)) ||
		(selectedPath && installations.find((item) => item.developerDir === selectedPath)) ||
		installations[0];

	return installations.map((item) => ({
		...item,
		isSelected: preferred ? item.developerDir === preferred.developerDir : false,
	}));
}

export async function getIosToolchainSnapshot(): Promise<IosToolchainSnapshot> {
	const preferences = await readPreferences();
	const xcodes = await listXcodeInstallations(preferences.xcodeDeveloperDir);
	const selectedXcode = xcodes.find((item) => item.isSelected) ?? null;
	const resolved: IosToolchainPreferences = {
		xcodeDeveloperDir: selectedXcode?.developerDir ?? preferences.xcodeDeveloperDir,
	};

	// Persist resolved defaults so later runner install can read them
	if (resolved.xcodeDeveloperDir !== preferences.xcodeDeveloperDir) {
		await writePreferences(resolved);
	}

	return { xcodes, preferences: resolved };
}

export async function setIosToolchainSelection(params: {
	xcodeDeveloperDir?: string | null;
}): Promise<IosToolchainPreferences> {
	const current = await readPreferences();
	const next: IosToolchainPreferences = {
		xcodeDeveloperDir:
			params.xcodeDeveloperDir === undefined ? current.xcodeDeveloperDir : params.xcodeDeveloperDir,
	};
	await writePreferences(next);
	return next;
}
