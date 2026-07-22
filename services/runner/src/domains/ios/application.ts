import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type DevicePrepRecord,
	type IosWdaInstallParams,
	type IosWdaInstallResult,
	wdaBundleIdForTeam,
} from "./models";

const YOQA_ROOT = join(homedir(), ".yoqa");
const DEFAULT_APPIUM_HOME = join(YOQA_ROOT, "appium");
const WDA_DERIVED_ROOT = join(YOQA_ROOT, "wda");
const DEVICE_PREP_DIR = join(YOQA_ROOT, "devices");
/** 1024×1024 PNG used as WebDriverAgent's home-screen icon (replaces Appium's). */
const WDA_APP_ICON_PATH = join(import.meta.dir, "../../../assets/wda-icon-1024.png");

async function runCommand(
	command: string[],
	options?: { env?: Record<string, string>; cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
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
	} catch {
		return { stdout: "", stderr: `failed to spawn: ${command[0]}`, exitCode: 127 };
	}
}

function tail(text: string, maxChars = 4_000): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `…${trimmed.slice(-maxChars)}`;
}

/** Prefer concrete `error:` lines from xcodebuild over the generic TEST BUILD FAILED footer. */
function summarizeXcodebuildFailure(stdout: string, stderr: string): string {
	const combined = `${stdout}\n${stderr}`;
	const errors = combined
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^[^:\s][^:]*:\s+error:/i.test(line) || /^error:/i.test(line))
		.map((line) => line.replace(/^.*?:\s+error:\s*/i, "").replace(/^error:\s*/i, ""))
		.filter(Boolean);

	const unique = [...new Set(errors)];
	if (unique.length > 0) {
		return unique.slice(0, 3).join(" ");
	}
	return tail(stderr || stdout) || "unknown xcodebuild failure";
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Locate WebDriverAgent.xcodeproj shipped with the installed XCUITest driver.
 */
export async function resolveWdaProjectPath(appiumHome?: string): Promise<string> {
	const homes = [
		appiumHome,
		process.env.APPIUM_HOME,
		DEFAULT_APPIUM_HOME,
		join(homedir(), ".appium"),
	].filter((value): value is string => Boolean(value?.trim()));

	const relative = join(
		"node_modules",
		"appium-xcuitest-driver",
		"node_modules",
		"appium-webdriveragent",
		"WebDriverAgent.xcodeproj",
	);

	for (const home of homes) {
		const candidate = join(home, relative);
		if (await pathExists(candidate)) return candidate;
	}

	throw new Error(
		"WebDriverAgent.xcodeproj not found. Ensure the XCUITest driver is installed (yoqa setup ios).",
	);
}

/**
 * Swap Appium's AppIcon for the YoQA mark so the installed WebDriverAgent
 * shows our branding on the device home screen. The WDA scheme's
 * embed-runner-icon.sh post-action then lifts the compiled icons into Runner.app.
 */
async function brandWdaAppIcon(projectPath: string): Promise<void> {
	if (!(await pathExists(WDA_APP_ICON_PATH))) {
		throw new Error(`YoQA WebDriverAgent icon not found at ${WDA_APP_ICON_PATH}`);
	}

	const iconPath = join(
		projectPath,
		"..",
		"WebDriverAgentRunner",
		"Assets.xcassets",
		"AppIcon.appiconset",
		"icon-1024.png",
	);
	if (!(await pathExists(iconPath))) {
		throw new Error(
			`WebDriverAgent AppIcon asset missing at ${iconPath}. Is appium-webdriveragent installed?`,
		);
	}

	await copyFile(WDA_APP_ICON_PATH, iconPath);
}

async function stripIos17TestFrameworks(appPath: string): Promise<void> {
	const frameworksDir = join(appPath, "Frameworks");
	if (!(await pathExists(frameworksDir))) return;

	const backupDir = join(appPath, "..", `WDA-framework-backup-${Date.now()}`);
	await mkdir(backupDir, { recursive: true });

	const entries = await readdir(frameworksDir);
	for (const entry of entries) {
		const shouldMove =
			entry.startsWith("XC") && entry.endsWith(".framework")
				? true
				: entry === "Testing.framework" || entry === "libXCTestSwiftSupport.dylib";
		if (!shouldMove) continue;
		await rename(join(frameworksDir, entry), join(backupDir, entry));
	}
}

/**
 * Read the leaf signing identity Xcode already used. Re-signing with a different
 * keychain cert (same CN, new serial) breaks install when that serial is absent
 * from embedded.mobileprovision — device error 0xe8008018.
 */
async function readBuiltSigningIdentity(appPath: string): Promise<string> {
	const { stderr, stdout } = await runCommand(["codesign", "-dvvv", appPath]);
	const combined = `${stdout}\n${stderr}`;
	// First Authority= line is the leaf identity; later lines are intermediate CAs.
	const leaf = combined
		.split("\n")
		.map((line) => line.trim())
		.find((line) => /^Authority=(Apple Development:|iPhone Developer:)/.test(line));
	if (!leaf) {
		throw new Error(`Could not determine WebDriverAgent signing identity from ${appPath}`);
	}
	return leaf.replace(/^Authority=/, "");
}

async function exportEntitlements(appPath: string, destPath: string): Promise<void> {
	const { stderr, stdout, exitCode } = await runCommand([
		"codesign",
		"-d",
		`--entitlements=${destPath}`,
		"--xml",
		appPath,
	]);
	if (exitCode !== 0 || !(await pathExists(destPath))) {
		throw new Error(
			`Failed to export WebDriverAgent entitlements: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
		);
	}
}

/** Nested bundles deepest-first so the outer app is signed last. */
async function listNestedSignablePaths(appPath: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			const isBundle =
				entry.endsWith(".framework") ||
				entry.endsWith(".appex") ||
				entry.endsWith(".xctest") ||
				entry.endsWith(".dylib");
			if (isBundle) found.push(full);
			// Continue into bundles to discover deeper frameworks.
			await walk(full);
		}
	}
	await walk(appPath);
	// Deepest paths first (longer path ⇒ nested further).
	return found.sort((a, b) => b.length - a.length);
}

/**
 * Re-sign after stripping iOS 17+ test frameworks.
 * Keep the build's signing identity + entitlements so the embedded profile still matches.
 */
async function resignWdaApp(appPath: string): Promise<void> {
	const identity = await readBuiltSigningIdentity(appPath);
	const entsDir = await mkdtemp(join(tmpdir(), "yoqa-wda-ents-"));
	const entitlementsPath = join(entsDir, "entitlements.plist");
	try {
		await exportEntitlements(appPath, entitlementsPath);

		const nested = await listNestedSignablePaths(appPath);
		for (const path of nested) {
			const { stderr, stdout, exitCode } = await runCommand([
				"codesign",
				"--force",
				"--sign",
				identity,
				"--timestamp=none",
				"--generate-entitlement-der",
				path,
			]);
			if (exitCode !== 0) {
				throw new Error(
					`Failed to re-sign ${path}: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
				);
			}
		}

		const { stderr, stdout, exitCode } = await runCommand([
			"codesign",
			"--force",
			"--sign",
			identity,
			"--timestamp=none",
			`--entitlements=${entitlementsPath}`,
			"--generate-entitlement-der",
			appPath,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`Failed to re-sign WebDriverAgent: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
			);
		}

		const verify = await runCommand(["codesign", "--verify", "--deep", "--strict", appPath]);
		if (verify.exitCode !== 0) {
			throw new Error(
				`WebDriverAgent signature invalid after re-sign: ${tail(verify.stderr || verify.stdout)}`,
			);
		}
	} finally {
		await rm(entsDir, { recursive: true, force: true });
	}
}

async function buildWda(params: {
	projectPath: string;
	derivedDataPath: string;
	xcodeDeveloperDir: string;
	developmentTeam: string;
	codeSignIdentity: string;
	bundleId: string;
}): Promise<string> {
	await mkdir(params.derivedDataPath, { recursive: true });

	const env = {
		DEVELOPER_DIR: params.xcodeDeveloperDir,
	};

	// Use the generic "Apple Development" identity with automatic signing.
	// Passing the full identity string (e.g. "Apple Development: Name (ID)") conflicts
	// with CODE_SIGN_STYLE=Automatic and fails the WDA project build.
	const { stderr, stdout, exitCode } = await runCommand(
		[
			"xcodebuild",
			"clean",
			"build-for-testing",
			"-project",
			params.projectPath,
			"-scheme",
			"WebDriverAgentRunner",
			"-destination",
			"generic/platform=iOS",
			"-derivedDataPath",
			params.derivedDataPath,
			"-allowProvisioningUpdates",
			"-allowProvisioningDeviceRegistration",
			`PRODUCT_BUNDLE_IDENTIFIER=${params.bundleId}`,
			`DEVELOPMENT_TEAM=${params.developmentTeam}`,
			"CODE_SIGN_IDENTITY=Apple Development",
			"CODE_SIGN_STYLE=Automatic",
		],
		{ env },
	);

	if (exitCode !== 0) {
		throw new Error(
			`xcodebuild failed while building WebDriverAgent: ${summarizeXcodebuildFailure(stdout, stderr)}`,
		);
	}

	const appPath = join(
		params.derivedDataPath,
		"Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app",
	);
	if (!(await pathExists(appPath))) {
		throw new Error(`WebDriverAgent build succeeded but app not found at ${appPath}`);
	}
	return appPath;
}

async function installWdaApp(deviceId: string, appPath: string): Promise<void> {
	const tempDir = await mkdtemp(join(tmpdir(), "yoqa-wda-install-"));
	const jsonPath = join(tempDir, "devicectl-install.json");
	try {
		const { stderr, stdout, exitCode } = await runCommand([
			"xcrun",
			"devicectl",
			"device",
			"install",
			"app",
			"--device",
			deviceId,
			"--json-output",
			jsonPath,
			appPath,
		]);

		if (exitCode !== 0) {
			throw new Error(
				`Failed to install WebDriverAgent on device ${deviceId}: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
			);
		}
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function persistDevicePrep(record: DevicePrepRecord): Promise<void> {
	await mkdir(DEVICE_PREP_DIR, { recursive: true });
	const path = join(DEVICE_PREP_DIR, `${record.deviceId}.json`);
	await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * Build, post-process (iOS 17+), install WebDriverAgent on a physical device,
 * and persist prep metadata for later Appium sessions.
 */
export async function installWdaOnDevice(
	params: IosWdaInstallParams,
): Promise<IosWdaInstallResult> {
	if (!(await pathExists(params.xcodeDeveloperDir))) {
		throw new Error(
			`Xcode developer directory not found: ${params.xcodeDeveloperDir}. Pick Xcode in Settings.`,
		);
	}

	const projectPath = await resolveWdaProjectPath(params.appiumHome);
	const derivedDataPath = join(WDA_DERIVED_ROOT, params.deviceId);
	const bundleId = wdaBundleIdForTeam(params.developmentTeam);

	// Fresh derived data avoids stale signing / provisioning mismatches.
	await rm(derivedDataPath, { recursive: true, force: true });

	await brandWdaAppIcon(projectPath);

	const appPath = await buildWda({
		projectPath,
		derivedDataPath,
		xcodeDeveloperDir: params.xcodeDeveloperDir,
		developmentTeam: params.developmentTeam,
		codeSignIdentity: params.codeSignIdentity,
		bundleId,
	});

	await stripIos17TestFrameworks(appPath);
	await resignWdaApp(appPath);
	await installWdaApp(params.deviceId, appPath);

	await persistDevicePrep({
		deviceId: params.deviceId,
		platform: "ios",
		bundleId,
		appPath,
		derivedDataPath,
		developmentTeam: params.developmentTeam,
		codeSignIdentity: params.codeSignIdentity,
		xcodeDeveloperDir: params.xcodeDeveloperDir,
		installedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		bundleId,
		appPath,
		derivedDataPath,
		deviceId: params.deviceId,
	};
}
