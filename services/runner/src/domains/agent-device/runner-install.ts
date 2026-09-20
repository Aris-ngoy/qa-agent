import type { Dirent } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import yoqaIconFile from "../../../assets/yoqa-ad-runner-icon.png" with { type: "file" };
import { runAgentDevice } from "./cli";
import { readDesktopIosSigning } from "./desktop-settings";

/**
 * The on-device iOS helper built by agent-device, branded for Yoqa.
 * Installed via `prepare ios-runner`, then renamed/re-iconed in place so the
 * home-screen entry reads YoqaADRunner with the Yoqa mark (same treatment the
 * Appium WebDriverAgent got via `brandWdaAppIcon`).
 */
export const YOQA_RUNNER_DISPLAY_NAME = "YoqaADRunner";

/** Fallback bundle id when Settings/env provide none (mirrors desktop default). */
export const DEFAULT_YOQA_RUNNER_BUNDLE_ID = "com.yoqa.agentdevice.runner";

/** 1024x1024 Yoqa mark used as the runner's home-screen icon. */
const YOQA_ICON_PATH = yoqaIconFile;

const YOQA_ROOT = join(homedir(), ".yoqa");
const RUNNER_PREP_DIR = join(YOQA_ROOT, "devices");
const AGENT_DEVICE_STATE_ROOT = join(homedir(), ".agent-device", "apple-runner", "derived");

export type IosRunnerKind = "physical" | "simulator" | "emulator";

export type IosRunnerAction = "reused" | "reinstalled" | "built";

export type IosRunnerInstallParams = {
	deviceId: string;
	kind?: IosRunnerKind;
	/** When true, always rebuild even if prep/cache is valid */
	force?: boolean;
};

export type IosRunnerInstallResult = {
	ok: true;
	bundleId: string;
	displayName: typeof YOQA_RUNNER_DISPLAY_NAME;
	appPath: string;
	derivedDataPath: string | null;
	deviceId: string;
	action: IosRunnerAction;
	/** True when branding was applied; false = installed unbranded (functional). */
	branded: boolean;
	/** Stale runner copies removed so exactly one stays on the device. */
	removedStale: string[];
	/** Non-fatal note (e.g. built bundle id differs from Settings). */
	warning?: string;
};

export type IosRunnerPrepRecord = {
	deviceId: string;
	platform: "ios";
	bundleId: string;
	teamId: string;
	appPath: string;
	derivedDataPath: string | null;
	branded: boolean;
	installedAt: string;
};

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

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function ensureMacos(): void {
	if (process.platform !== "darwin") {
		throw new Error("Installing the iOS runner requires macOS with Xcode installed.");
	}
}

/** Team + bundle id from desktop Settings (explicit env wins inside runAgentDevice). */
export async function resolveRunnerSigning(): Promise<{ teamId: string; bundleId: string }> {
	const signing = await readDesktopIosSigning();
	const teamId = process.env.AGENT_DEVICE_IOS_TEAM_ID?.trim() || signing.teamId || "";
	const bundleId =
		process.env.AGENT_DEVICE_IOS_BUNDLE_ID?.trim() ||
		signing.bundleId ||
		DEFAULT_YOQA_RUNNER_BUNDLE_ID;
	if (!teamId) {
		throw new Error(
			"No Apple Development team selected. Open Settings → iOS, pick a signing identity, then install again.",
		);
	}
	return { teamId, bundleId };
}

function derivedRoots(): string[] {
	const override = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
	const roots = override ? [override, AGENT_DEVICE_STATE_ROOT] : [AGENT_DEVICE_STATE_ROOT];
	return roots;
}

/** Newest directory first (so a fresh prepare wins over stale caches). */
async function listDerivedDirs(): Promise<string[]> {
	const found: string[] = [];
	for (const root of derivedRoots()) {
		let entries: string[];
		try {
			entries = await readdir(root);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(root, entry);
			try {
				const st = await stat(full);
				if (st.isDirectory()) found.push(full);
			} catch {
				// ignore
			}
		}
	}
	const withMtime = await Promise.all(
		found.map(async (dir) => {
			try {
				return { dir, mtime: (await stat(dir)).mtimeMs };
			} catch {
				return { dir, mtime: 0 };
			}
		}),
	);
	withMtime.sort((a, b) => b.mtime - a.mtime);
	return withMtime.map((item) => item.dir);
}

async function findAppsUnder(dir: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(current: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.endsWith(".app")) found.push(full);
				else await walk(full);
			}
		}
	}
	await walk(dir);
	return found.sort((a, b) => a.localeCompare(b));
}

function isHostApp(appPath: string): boolean {
	const base = appPath.split("/").pop() ?? "";
	// Host app is `AgentDeviceRunner.app`; test runners end with `-Runner.app`.
	return base === "AgentDeviceRunner.app";
}

/** CFBundleIdentifier of a built .app, or null when unreadable. */
export async function readAppBundleId(appPath: string): Promise<string | null> {
	const infoPlist = join(appPath, "Info.plist");
	// plutil handles binary and XML plists (macOS only).
	if (process.platform === "darwin") {
		try {
			const proc = Bun.spawn(["plutil", "-extract", "CFBundleIdentifier", "raw", infoPlist], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
			if (exitCode === 0 && stdout.trim()) return stdout.trim();
		} catch {
			// fall through to the XML fallback below
		}
	}
	// Portable fallback for XML plists (covers CI/Linux and test fixtures).
	try {
		const text = await Bun.file(infoPlist).text();
		const match = text.match(
			/<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/,
		);
		return match?.[1]?.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Locate the built runner host app (`AgentDeviceRunner.app`) in agent-device's
 * derived data. Prefers simulators' products only when kind is not physical;
 * otherwise prefers iphoneos products. When `expectedBundleId` is given,
 * candidates carrying that bundle id win — branding writes bump mtimes, so a
 * pure newest-first pick can otherwise return a stale cache from a previous
 * bundle id / team.
 */
export async function locateRunnerHostApp(
	kind: IosRunnerKind,
	expectedBundleId?: string,
): Promise<{ appPath: string; derivedDataPath: string } | null> {
	type Candidate = { appPath: string; derivedDataPath: string; mtime: number };
	const candidates: Candidate[] = [];
	for (const dir of await listDerivedDirs()) {
		const apps = await findAppsUnder(dir);
		const hosts = apps.filter(isHostApp);
		if (hosts.length === 0) continue;
		const preferred =
			kind === "physical"
				? (hosts.find((app) => app.includes("iphoneos")) ?? hosts[0])
				: (hosts.find((app) => app.includes("iphonesimulator")) ?? hosts[0]);
		if (!preferred) continue;
		let mtime = 0;
		try {
			mtime = (await stat(preferred)).mtimeMs;
		} catch {
			// ignore
		}
		candidates.push({ appPath: preferred, derivedDataPath: dir, mtime });
	}
	if (candidates.length === 0) return null;
	if (expectedBundleId) {
		for (const candidate of [...candidates].sort((a, b) => b.mtime - a.mtime)) {
			if ((await readAppBundleId(candidate.appPath)) === expectedBundleId) {
				return { appPath: candidate.appPath, derivedDataPath: candidate.derivedDataPath };
			}
		}
	}
	candidates.sort((a, b) => b.mtime - a.mtime);
	const newest = candidates[0];
	if (!newest) return null;
	return { appPath: newest.appPath, derivedDataPath: newest.derivedDataPath };
}

type DevicectlAppsJson = {
	result?: {
		apps?: Array<{ bundleIdentifier?: string }>;
	};
};

/** True when the branded bundle id is installed on the target device. */
export async function isRunnerInstalledOnDevice(
	deviceId: string,
	bundleId: string,
	kind: IosRunnerKind,
): Promise<boolean> {
	if (kind === "physical") {
		const tempDir = await mkdtemp(join(tmpdir(), "yoqa-runner-apps-"));
		const jsonPath = join(tempDir, "devicectl-apps.json");
		try {
			const { exitCode } = await runCommand([
				"xcrun",
				"devicectl",
				"device",
				"info",
				"apps",
				"--device",
				deviceId,
				"--bundle-id",
				bundleId,
				"--json-output",
				jsonPath,
			]);
			if (exitCode !== 0 || !(await pathExists(jsonPath))) return false;
			try {
				const parsed = JSON.parse(await Bun.file(jsonPath).text()) as DevicectlAppsJson;
				return (parsed.result?.apps ?? []).some((app) => app.bundleIdentifier === bundleId);
			} catch {
				return false;
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
	const { exitCode } = await runCommand([
		"xcrun",
		"simctl",
		"get_app_container",
		deviceId,
		bundleId,
	]);
	return exitCode === 0;
}

/**
 * Bundle ids of runner-like apps actually on the device (unfiltered query).
 * Used for diagnostics and stale-runner cleanup. Pass `runnerOnly: false` to
 * get every installed bundle id.
 */
async function listRunnerLikeAppsOnDevice(
	deviceId: string,
	kind: IosRunnerKind,
	runnerOnly = true,
): Promise<string[]> {
	const isRunnerLike = (id: string) => !runnerOnly || /runner|agentdevice|yoqa/i.test(id);
	try {
		if (kind === "physical") {
			const tempDir = await mkdtemp(join(tmpdir(), "yoqa-runner-apps-all-"));
			const jsonPath = join(tempDir, "devicectl-apps.json");
			try {
				const { exitCode } = await runCommand([
					"xcrun",
					"devicectl",
					"device",
					"info",
					"apps",
					"--device",
					deviceId,
					"--json-output",
					jsonPath,
				]);
				if (exitCode !== 0 || !(await pathExists(jsonPath))) return [];
				const parsed = JSON.parse(await Bun.file(jsonPath).text()) as DevicectlAppsJson;
				const ids = (parsed.result?.apps ?? [])
					.map((app) => app.bundleIdentifier ?? "")
					.filter(Boolean);
				return [...new Set(ids)].filter(isRunnerLike).slice(0, 50);
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		}
		const { stdout, exitCode } = await runCommand(["xcrun", "simctl", "listapps", deviceId]);
		if (exitCode !== 0) return [];
		const ids = [...stdout.matchAll(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/g)].map(
			(m) => m[1] ?? "",
		);
		return [...new Set(ids)].filter(isRunnerLike).slice(0, 50);
	} catch {
		return [];
	}
}

/**
 * Bundle ids on the device that look like agent-device runners but are not
 * the one we just installed. iOS keys apps by bundle id, so a Settings bundle
 * change otherwise leaves two home-screen runners behind.
 */
export function staleRunnerBundleIds(allIds: string[], keepBundleId: string): string[] {
	const seen = new Set<string>();
	const stale: string[] = [];
	for (const id of allIds) {
		if (!id || id === keepBundleId || id.startsWith(`${keepBundleId}.`) || seen.has(id)) {
			continue;
		}
		seen.add(id);
		if (/agentdevice\.runner/i.test(id)) stale.push(id);
	}
	return stale;
}

/**
 * Remove stale runner copies so exactly one runner stays on the device.
 * Best-effort per bundle id — uninstall failures never fail the install.
 */
async function uninstallStaleRunners(
	deviceId: string,
	kind: IosRunnerKind,
	keepBundleId: string,
): Promise<string[]> {
	const all = await listRunnerLikeAppsOnDevice(deviceId, kind, false);
	const stale = staleRunnerBundleIds(all, keepBundleId);
	const removed: string[] = [];
	for (const bundleId of stale) {
		try {
			const result =
				kind === "physical"
					? await runCommand([
							"xcrun",
							"devicectl",
							"device",
							"uninstall",
							"app",
							"--device",
							deviceId,
							bundleId,
						])
					: await runCommand(["xcrun", "simctl", "uninstall", deviceId, bundleId]);
			if (result.exitCode === 0) removed.push(bundleId);
		} catch {
			// ignore — stale cleanup must not fail the install
		}
	}
	return removed;
}

async function installAppOnDevice(
	deviceId: string,
	appPath: string,
	kind: IosRunnerKind,
): Promise<void> {
	if (kind === "physical") {
		const tempDir = await mkdtemp(join(tmpdir(), "yoqa-runner-install-"));
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
					`Failed to install ${YOQA_RUNNER_DISPLAY_NAME} on device ${deviceId}: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
				);
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
		return;
	}
	const { stderr, stdout, exitCode } = await runCommand([
		"xcrun",
		"simctl",
		"install",
		deviceId,
		appPath,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Failed to install ${YOQA_RUNNER_DISPLAY_NAME} on simulator ${deviceId}: ${tail(stderr || stdout) || `exit ${exitCode}`}`,
		);
	}
}

/**
 * Brand the built host app in place: display name → YoqaADRunner, Yoqa mark
 * icons, then re-sign with the build's own identity so the embedded
 * provisioning profile still matches (same approach as the legacy WDA flow).
 * Returns true when branding applied, false when skipped (functional install).
 */
async function brandRunnerHostApp(appPath: string): Promise<boolean> {
	try {
		const iconSource = Bun.file(YOQA_ICON_PATH);
		if (!(await iconSource.exists())) return false;
		const bytes = new Uint8Array(await iconSource.arrayBuffer());
		if (bytes.byteLength === 0) return false;

		const infoPlist = join(appPath, "Info.plist");
		if (!(await pathExists(infoPlist))) return false;

		// Display name shown on the home screen.
		const display = await runCommand([
			"plutil",
			"-replace",
			"CFBundleDisplayName",
			"-string",
			YOQA_RUNNER_DISPLAY_NAME,
			infoPlist,
		]);
		if (display.exitCode !== 0) return false;

		// Loose PNGs + CFBundleIcons entry (no asset catalog in this target).
		const iconBase = "YoqaADRunnerIcon";
		await Bun.write(join(appPath, `${iconBase}@2x.png`), bytes);
		await Bun.write(join(appPath, `${iconBase}@3x.png`), bytes);
		const iconsJson = JSON.stringify({
			CFBundlePrimaryIcon: { CFBundleIconFiles: [iconBase], UIPrerenderedIcon: false },
		});
		const icons = await runCommand([
			"plutil",
			"-replace",
			"CFBundleIcons",
			"-json",
			iconsJson,
			infoPlist,
		]);
		if (icons.exitCode !== 0) return false;

		await resignApp(appPath);
		return true;
	} catch {
		return false;
	}
}

async function readBuiltSigningIdentity(appPath: string): Promise<string> {
	const { stderr, stdout } = await runCommand(["codesign", "-dvvv", appPath]);
	const combined = `${stdout}\n${stderr}`;
	const leaf = combined
		.split("\n")
		.map((line) => line.trim())
		.find((line) => /^Authority=(Apple Development:|iPhone Developer:)/.test(line));
	if (!leaf) throw new Error("Could not determine runner signing identity");
	return leaf.replace(/^Authority=/, "");
}

async function resignApp(appPath: string): Promise<void> {
	// Simulator builds are unsigned — nothing to repair.
	const verify = await runCommand(["codesign", "--verify", "--deep", "--strict", appPath]);
	if (verify.exitCode === 0) return;
	const unsignedHint = /code object is not signed/i.test(verify.stderr || verify.stdout);
	if (unsignedHint) return;

	const identity = await readBuiltSigningIdentity(appPath);
	const tempDir = await mkdtemp(join(tmpdir(), "yoqa-runner-ents-"));
	const entitlementsPath = join(tempDir, "entitlements.plist");
	try {
		const exported = await runCommand([
			"codesign",
			"-d",
			`--entitlements=${entitlementsPath}`,
			"--xml",
			appPath,
		]);
		if (exported.exitCode !== 0 || !(await pathExists(entitlementsPath))) {
			throw new Error("Failed to export runner entitlements");
		}
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
			throw new Error(`Failed to re-sign runner: ${tail(stderr || stdout) || `exit ${exitCode}`}`);
		}
		const reverify = await runCommand(["codesign", "--verify", "--deep", "--strict", appPath]);
		if (reverify.exitCode !== 0) {
			throw new Error(
				`Runner signature invalid after re-sign: ${tail(reverify.stderr || reverify.stdout)}`,
			);
		}
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function listNestedSignablePaths(appPath: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const full = join(dir, entry.name);
			if (
				entry.name.endsWith(".framework") ||
				entry.name.endsWith(".appex") ||
				entry.name.endsWith(".xctest") ||
				entry.name.endsWith(".dylib")
			) {
				found.push(full);
			}
			await walk(full);
		}
	}
	await walk(appPath);
	return found.sort((a, b) => b.length - a.length);
}

async function persistPrep(record: IosRunnerPrepRecord): Promise<void> {
	await mkdir(RUNNER_PREP_DIR, { recursive: true });
	await writeFile(
		join(RUNNER_PREP_DIR, `${record.deviceId}.json`),
		`${JSON.stringify(record, null, 2)}\n`,
		"utf8",
	);
}

export async function loadRunnerPrep(deviceId: string): Promise<IosRunnerPrepRecord | null> {
	try {
		const parsed = JSON.parse(
			await Bun.file(join(RUNNER_PREP_DIR, `${deviceId}.json`)).text(),
		) as Partial<IosRunnerPrepRecord>;
		// Records written before team tracking (or hand-edited) can't be trusted
		// to match current signing — ignore them instead of crashing later in
		// prepMatches (`prep.teamId.trim` on undefined).
		if (!parsed?.deviceId || !parsed?.bundleId || typeof parsed?.teamId !== "string") {
			return null;
		}
		return parsed as IosRunnerPrepRecord;
	} catch {
		return null;
	}
}

export function prepMatches(prep: IosRunnerPrepRecord, teamId: string, bundleId: string): boolean {
	const prepTeam = typeof prep.teamId === "string" ? prep.teamId.trim() : "";
	if (!prepTeam) return false;
	return prepTeam === teamId.trim() && prep.bundleId === bundleId;
}

/** Run agent-device's own runner build/cache warm for the platform. */
async function prepareRunner(deviceId: string, clean = false): Promise<void> {
	const base = ["prepare", "ios-runner", "--platform", "ios"];
	// Yoqa ios device ids are UDIDs (see deviceSelectorArgs in devices/session).
	const selector = ["--udid", deviceId];
	const run = () => runAgentDevice([...base, ...selector], { timeoutMs: 600_000 });
	if (!clean) {
		try {
			await run();
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/unknown|unrecognized|invalid.*(udid|device|selector|option|flag)/i.test(message)) {
				await runAgentDevice(base, { timeoutMs: 600_000 });
				return;
			}
			throw error;
		}
	}
	// Converge a stale cache (e.g. Settings bundle id changed since the last
	// build): wipe derived data so the rebuild uses current signing env.
	const previous = process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED;
	process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED = "1";
	try {
		await run();
	} finally {
		// Empty string is falsy like unset for agent-device's truthy check.
		process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED = previous ?? "";
	}
}

/**
 * Build (via agent-device), brand as YoqaADRunner, and install the iOS
 * runner on the target device. Nothing else: no app launches, no extra
 * sessions — prepare builds, we brand, we install, we verify.
 */
export async function installYoqaRunnerOnDevice(
	params: IosRunnerInstallParams,
): Promise<IosRunnerInstallResult> {
	ensureMacos();
	const kind = params.kind === "emulator" ? "simulator" : (params.kind ?? "physical");
	const { teamId, bundleId } = await resolveRunnerSigning();
	const existing = params.force ? null : await loadRunnerPrep(params.deviceId);

	if (!params.force && existing && prepMatches(existing, teamId, bundleId)) {
		if (await isRunnerInstalledOnDevice(params.deviceId, existing.bundleId, kind)) {
			return {
				ok: true,
				bundleId: existing.bundleId,
				displayName: YOQA_RUNNER_DISPLAY_NAME,
				appPath: existing.appPath,
				derivedDataPath: existing.derivedDataPath,
				deviceId: params.deviceId,
				action: "reused",
				branded: existing.branded,
				removedStale: [],
			};
		}
		if (await pathExists(existing.appPath)) {
			await installAppOnDevice(params.deviceId, existing.appPath, kind);
			if (!(await isRunnerInstalledOnDevice(params.deviceId, existing.bundleId, kind))) {
				throw new Error(
					`Install reported success but ${YOQA_RUNNER_DISPLAY_NAME} is not on the device. Reconnect and try again.`,
				);
			}
			const removedStale = await uninstallStaleRunners(params.deviceId, kind, existing.bundleId);
			await persistPrep({ ...existing, installedAt: new Date().toISOString() });
			return {
				ok: true,
				bundleId: existing.bundleId,
				displayName: YOQA_RUNNER_DISPLAY_NAME,
				appPath: existing.appPath,
				derivedDataPath: existing.derivedDataPath,
				deviceId: params.deviceId,
				action: "reinstalled",
				branded: existing.branded,
				removedStale,
			};
		}
	}

	await prepareRunner(params.deviceId);
	let located = await locateRunnerHostApp(kind, bundleId);
	if (!located) {
		throw new Error(
			"Runner build finished but no AgentDeviceRunner.app was found in derived data. Reconnect and try again.",
		);
	}

	// The cache may predate the current Settings (bundle id / team): rebuild
	// clean once so the installed app converges to what connect will use.
	let builtBundleId = (await readAppBundleId(located.appPath)) ?? bundleId;
	if (builtBundleId !== bundleId) {
		await prepareRunner(params.deviceId, true);
		const relocated = await locateRunnerHostApp(kind, bundleId);
		if (relocated) {
			located = relocated;
			builtBundleId = (await readAppBundleId(located.appPath)) ?? bundleId;
		}
	}

	const branded = await brandRunnerHostApp(located.appPath);

	// Verify against the bundle id that was actually built — the Settings
	// value may have changed since the cache was built (or vice versa).
	const bundleMismatch = builtBundleId !== bundleId;
	const verifyBundleId = builtBundleId;
	const warning = bundleMismatch
		? `Runner was built as ${builtBundleId} but Settings uses ${bundleId}. Update Settings → iOS to match, then reinstall.`
		: undefined;

	try {
		await installAppOnDevice(params.deviceId, located.appPath, kind);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`${detail} Make sure the device is unlocked, trusted, and registered with your Apple team, then retry.`,
		);
	}

	if (!(await isRunnerInstalledOnDevice(params.deviceId, verifyBundleId, kind))) {
		const found = await listRunnerLikeAppsOnDevice(params.deviceId, kind);
		const foundHint = found.length > 0 ? ` Found runner-like apps: ${found.join(", ")}.` : "";
		throw new Error(
			`Install reported success but ${YOQA_RUNNER_DISPLAY_NAME} (${verifyBundleId}) is not on the device.${foundHint} Check that the device is trusted, unlocked, and registered with your Apple team.`,
		);
	}

	// Leave exactly one runner behind: drop stale copies from previous
	// bundle ids (e.g. after a Settings bundle change).
	const removedStale = await uninstallStaleRunners(params.deviceId, kind, verifyBundleId);

	await persistPrep({
		deviceId: params.deviceId,
		platform: "ios",
		bundleId: verifyBundleId,
		teamId,
		appPath: located.appPath,
		derivedDataPath: located.derivedDataPath,
		branded,
		installedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		bundleId: verifyBundleId,
		displayName: YOQA_RUNNER_DISPLAY_NAME,
		appPath: located.appPath,
		derivedDataPath: located.derivedDataPath,
		deviceId: params.deviceId,
		action: "built",
		branded,
		removedStale,
		...(warning ? { warning } : {}),
	};
}

/** Read-only install status for the dialog (installs nothing). */
export async function getYoqaRunnerStatus(
	deviceId: string,
	kind: IosRunnerKind,
): Promise<{ installed: boolean; bundleId: string; displayName: typeof YOQA_RUNNER_DISPLAY_NAME }> {
	const { bundleId } = await resolveRunnerSigning().catch(() => ({
		teamId: "",
		bundleId: DEFAULT_YOQA_RUNNER_BUNDLE_ID,
	}));
	const normalized = kind === "emulator" ? "simulator" : kind;
	return {
		installed: await isRunnerInstalledOnDevice(deviceId, bundleId, normalized),
		bundleId,
		displayName: YOQA_RUNNER_DISPLAY_NAME,
	};
}
