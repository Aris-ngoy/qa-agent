import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DevicePlatform } from "@yoqa/runner-client";
import {
	type AppiumDriverName,
	MANAGED_APPIUM_VERSION,
	MANAGED_DRIVER_VERSIONS,
	type PlatformSetupResult,
	type ResolvedAppium,
	type RuntimeCheck,
	type RuntimeEnsureResult,
	type RuntimeStatus,
	driverForPlatform,
} from "./models";

const YOQA_ROOT = join(homedir(), ".yoqa");
const MANAGED_RUNTIME_DIR = join(YOQA_ROOT, "runtime");
const MANAGED_APPIUM_HOME = join(YOQA_ROOT, "appium");
const MANAGED_APPIUM_BIN = join(MANAGED_RUNTIME_DIR, "node_modules", "appium", "index.js");
const MANAGED_PACKAGE_JSON = join(MANAGED_RUNTIME_DIR, "package.json");

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

async function which(bin: string): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["which", bin]);
	if (exitCode !== 0) return null;
	const path = stdout.trim().split("\n")[0]?.trim();
	return path || null;
}

async function readAppiumVersion(
	bin: string,
	env?: Record<string, string>,
): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["node", bin, "-v"], { env });
	if (exitCode !== 0) {
		// System installs may be a shell script / bin shim — try invoking directly.
		const direct = await runCommand([bin, "-v"], { env });
		if (direct.exitCode !== 0) return null;
		const version = direct.stdout.trim().split("\n")[0]?.trim();
		return version || null;
	}
	const version = stdout.trim().split("\n")[0]?.trim();
	return version || null;
}

async function ensureNpmAvailable(): Promise<void> {
	const npm = await which("npm");
	if (!npm) {
		throw new Error("npm is required to install Appium but was not found on PATH");
	}
	const node = await which("node");
	if (!node) {
		throw new Error("node is required to install Appium but was not found on PATH");
	}
}

async function writeManagedPackageJson(): Promise<void> {
	const body = {
		name: "yoqa-runtime",
		private: true,
		description: "Managed Appium runtime for yoqa",
		dependencies: {
			appium: MANAGED_APPIUM_VERSION,
		},
	};
	await writeFile(MANAGED_PACKAGE_JSON, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function managedAppiumEnv(): Record<string, string> {
	return {
		APPIUM_HOME: MANAGED_APPIUM_HOME,
		// Keep npm from walking up to a parent package.json during driver installs.
		npm_config_prefix: MANAGED_RUNTIME_DIR,
	};
}

async function ensureManagedAppium(): Promise<ResolvedAppium> {
	await ensureNpmAvailable();
	await mkdir(MANAGED_RUNTIME_DIR, { recursive: true });
	await mkdir(MANAGED_APPIUM_HOME, { recursive: true });
	await writeManagedPackageJson();

	const env = managedAppiumEnv();
	const existingVersion = await readAppiumVersion(MANAGED_APPIUM_BIN, env);
	if (!existingVersion) {
		const { stderr, stdout, exitCode } = await runCommand(
			["npm", "install", "--no-fund", "--no-audit", "--prefix", MANAGED_RUNTIME_DIR],
			{ cwd: MANAGED_RUNTIME_DIR, env },
		);
		if (exitCode !== 0) {
			throw new Error(
				`Failed to install Appium ${MANAGED_APPIUM_VERSION}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
			);
		}
	}

	const version = await readAppiumVersion(MANAGED_APPIUM_BIN, env);
	if (!version) {
		throw new Error(`Managed Appium binary not found at ${MANAGED_APPIUM_BIN}`);
	}

	return {
		bin: MANAGED_APPIUM_BIN,
		version,
		source: "managed",
		env,
		cwd: MANAGED_RUNTIME_DIR,
		invokeViaNode: true,
	};
}

export async function resolveAppium(): Promise<ResolvedAppium> {
	const systemBin = await which("appium");
	if (systemBin) {
		const version = await readAppiumVersion(systemBin);
		// Pinned drivers target Appium 3.x — ignore older system installs and use managed.
		if (version?.startsWith("3.")) {
			return {
				bin: systemBin,
				version,
				source: "system",
				env: {},
				cwd: undefined,
				invokeViaNode: false,
			};
		}
	}

	return ensureManagedAppium();
}

type InstalledDriversJson = Record<
	string,
	{
		pkg?: { version?: string };
		version?: string;
		installed?: boolean;
	}
>;

function parseInstalledDrivers(stdout: string): InstalledDriversJson {
	try {
		return JSON.parse(stdout) as InstalledDriversJson;
	} catch {
		return {};
	}
}

function driverVersionFromList(
	list: InstalledDriversJson,
	driver: AppiumDriverName,
): string | undefined {
	const entry = list[driver];
	if (!entry) return undefined;
	return entry.pkg?.version ?? entry.version;
}

function isDriverInstalled(list: InstalledDriversJson, driver: AppiumDriverName): boolean {
	const entry = list[driver];
	if (!entry) return false;
	if (entry.installed === false) return false;
	const version = entry.pkg?.version ?? entry.version;
	if (!version) return false;
	// Require the pinned managed version so we don't keep Appium-2-era drivers on Appium 3.
	return version === MANAGED_DRIVER_VERSIONS[driver];
}

function appiumArgs(appium: ResolvedAppium, args: string[]): string[] {
	if (appium.invokeViaNode) {
		return ["node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
}

async function listInstalledDrivers(appium: ResolvedAppium): Promise<InstalledDriversJson> {
	const { stdout, stderr, exitCode } = await runCommand(
		appiumArgs(appium, ["driver", "list", "--installed", "--json"]),
		{ env: appium.env, cwd: appium.cwd },
	);
	if (exitCode !== 0) {
		if (stderr.includes("unknown option") || stdout.includes("unknown option")) {
			return {};
		}
		throw new Error(
			`Failed to list Appium drivers: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`,
		);
	}
	return parseInstalledDrivers(stdout);
}

async function uninstallDriver(appium: ResolvedAppium, driver: AppiumDriverName): Promise<void> {
	const { stderr, stdout, exitCode } = await runCommand(
		appiumArgs(appium, ["driver", "uninstall", driver]),
		{ env: appium.env, cwd: appium.cwd },
	);
	if (exitCode !== 0) {
		const detail = stderr.trim() || stdout.trim();
		// Already gone is fine.
		if (/not installed|could not find/i.test(detail)) return;
		throw new Error(
			`Failed to uninstall Appium driver "${driver}": ${detail || `exit ${exitCode}`}`,
		);
	}
}

async function installDriver(appium: ResolvedAppium, driver: AppiumDriverName): Promise<void> {
	const spec = `${driver}@${MANAGED_DRIVER_VERSIONS[driver]}`;
	const { stderr, stdout, exitCode } = await runCommand(
		appiumArgs(appium, ["driver", "install", spec]),
		{
			env: appium.env,
			cwd: appium.cwd,
		},
	);
	if (exitCode !== 0) {
		throw new Error(
			`Failed to install Appium driver "${spec}": ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`,
		);
	}
}

/**
 * Ensure Appium is available and the platform driver is installed.
 * Idempotent — skips install when the pinned driver version is already present.
 */
export async function setupPlatform(platform: DevicePlatform): Promise<PlatformSetupResult> {
	const driver = driverForPlatform(platform);
	const appium = await resolveAppium();
	const expectedVersion = MANAGED_DRIVER_VERSIONS[driver];

	const before = await listInstalledDrivers(appium);
	const alreadyInstalled = isDriverInstalled(before, driver);
	const existingVersion = driverVersionFromList(before, driver);

	if (!alreadyInstalled) {
		// Wrong/outdated driver blocks `driver install` — remove first.
		if (existingVersion) {
			await uninstallDriver(appium, driver);
		}
		await installDriver(appium, driver);
	}

	const after = alreadyInstalled ? before : await listInstalledDrivers(appium);
	const driverVersion = driverVersionFromList(after, driver) ?? expectedVersion;

	if (!isDriverInstalled(after, driver)) {
		throw new Error(
			`Driver "${driver}@${expectedVersion}" was installed but does not appear in appium driver list`,
		);
	}

	const message = alreadyInstalled
		? `${driver} ${driverVersion} is already installed (Appium ${appium.version})`
		: `Installed ${driver} ${driverVersion} (Appium ${appium.version})`;

	return {
		ok: true,
		platform,
		driver,
		appiumVersion: appium.version,
		driverVersion,
		alreadyInstalled,
		message,
	};
}

/** Probe Appium without installing the managed runtime. */
async function probeAppium(): Promise<ResolvedAppium | null> {
	const systemBin = await which("appium");
	if (systemBin) {
		const version = await readAppiumVersion(systemBin);
		if (version?.startsWith("3.")) {
			return {
				bin: systemBin,
				version,
				source: "system",
				env: {},
				cwd: undefined,
				invokeViaNode: false,
			};
		}
	}

	const managedEnv = managedAppiumEnv();
	const managedVersion = await readAppiumVersion(MANAGED_APPIUM_BIN, managedEnv);
	if (managedVersion) {
		return {
			bin: MANAGED_APPIUM_BIN,
			version: managedVersion,
			source: "managed",
			env: managedEnv,
			cwd: MANAGED_RUNTIME_DIR,
			invokeViaNode: true,
		};
	}

	return null;
}

async function probeHostTools(): Promise<{ xcode: RuntimeCheck; adb: RuntimeCheck }> {
	const xcodePath = await which("xcodebuild");
	const adbPath = await which("adb");
	// Also accept SDK-bundled adb
	let adbOk = Boolean(adbPath);
	let adbDetail = adbPath ?? undefined;
	if (!adbOk) {
		const home = process.env.HOME ?? "";
		const sdkAdb = join(home, "Library/Android/sdk/platform-tools/adb");
		const { exitCode } = await runCommand(["test", "-x", sdkAdb]);
		if (exitCode === 0) {
			adbOk = true;
			adbDetail = sdkAdb;
		}
	}

	return {
		xcode: {
			id: "xcode",
			label: "Xcode",
			ok: Boolean(xcodePath),
			required: false,
			detail: xcodePath ?? "Not found — needed for iOS simulators",
		},
		adb: {
			id: "adb",
			label: "Android Debug Bridge",
			ok: adbOk,
			required: false,
			detail: adbDetail ?? "Not found — needed for Android devices",
		},
	};
}

/** Read-only readiness snapshot (does not install anything). */
export async function getRuntimeStatus(): Promise<RuntimeStatus> {
	const nodePath = await which("node");
	const npmPath = await which("npm");
	const appium = await probeAppium();
	const host = await probeHostTools();

	const checks: RuntimeCheck[] = [
		{
			id: "node",
			label: "Node.js",
			ok: Boolean(nodePath),
			required: true,
			detail: nodePath ?? "Not found on PATH",
		},
		{
			id: "npm",
			label: "npm",
			ok: Boolean(npmPath),
			required: true,
			detail: npmPath ?? "Not found on PATH",
		},
		{
			id: "appium",
			label: "Appium",
			ok: Boolean(appium),
			required: true,
			detail: appium
				? `${appium.version} (${appium.source})`
				: `Not installed (will install ${MANAGED_APPIUM_VERSION})`,
		},
	];

	let xcuitestOk = false;
	let uiautomator2Ok = false;
	let xcuitestDetail = "Waiting for Appium";
	let uiautomator2Detail = "Waiting for Appium";

	if (appium) {
		const drivers = await listInstalledDrivers(appium);
		const xcuitestVersion = driverVersionFromList(drivers, "xcuitest");
		const uiautomator2Version = driverVersionFromList(drivers, "uiautomator2");
		xcuitestOk = isDriverInstalled(drivers, "xcuitest");
		uiautomator2Ok = isDriverInstalled(drivers, "uiautomator2");
		xcuitestDetail = xcuitestOk
			? `${xcuitestVersion}`
			: xcuitestVersion
				? `Found ${xcuitestVersion}, need ${MANAGED_DRIVER_VERSIONS.xcuitest}`
				: `Not installed (need ${MANAGED_DRIVER_VERSIONS.xcuitest})`;
		uiautomator2Detail = uiautomator2Ok
			? `${uiautomator2Version}`
			: uiautomator2Version
				? `Found ${uiautomator2Version}, need ${MANAGED_DRIVER_VERSIONS.uiautomator2}`
				: `Not installed (need ${MANAGED_DRIVER_VERSIONS.uiautomator2})`;
	}

	checks.push(
		{
			id: "xcuitest",
			label: "XCUITest driver",
			ok: xcuitestOk,
			required: true,
			detail: xcuitestDetail,
		},
		{
			id: "uiautomator2",
			label: "UiAutomator2 driver",
			ok: uiautomator2Ok,
			required: true,
			detail: uiautomator2Detail,
		},
		host.xcode,
		host.adb,
	);

	const ready = checks.filter((check) => check.required).every((check) => check.ok);

	return {
		ready,
		appiumVersion: appium?.version,
		appiumSource: appium?.source,
		checks,
	};
}

/** Install Appium + both platform drivers, then return a fresh status. */
export async function ensureRuntime(): Promise<RuntimeEnsureResult> {
	const installed: PlatformSetupResult[] = [];
	installed.push(await setupPlatform("ios"));
	installed.push(await setupPlatform("android"));
	const status = await getRuntimeStatus();
	if (!status.ready) {
		const failed = status.checks.filter((check) => check.required && !check.ok);
		throw new Error(
			`Runtime still not ready after install: ${failed.map((check) => check.label).join(", ")}`,
		);
	}

	const anyInstalled = installed.some((item) => !item.alreadyInstalled);
	return {
		ok: true,
		ready: true,
		status,
		installed,
		message: anyInstalled
			? "Installed missing Appium drivers"
			: "All Appium drivers are already installed",
	};
}
