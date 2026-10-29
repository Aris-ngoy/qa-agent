/**
 * Installed Chromium-family browsers (Chrome, Edge, Brave, Chromium) as web devices, and
 * the Yoqa-owned instance a connect launches (ADR-0007). Launching an installed browser is
 * to a web device what booting is to a simulator: its App's Kept profile, a debug port the
 * browser picks itself, and no first-run screens. The user's own profile is never used.
 * Discovery is macOS only.
 *
 * A Kept profile lives at `~/.yoqa/browser-profiles/<appId>/<browserId>/` (`default` when
 * the connect names no App) and outlives the browser, so logins survive disconnects and
 * Runs. A clean profile is a temporary folder, deleted when the browser stops.
 */

import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserProfile, type Device, PROFILE_APP_ID_PATTERN } from "@yoqa/runner-client";
import type { ListDevicesOptions } from "./models";

/** The stable device id of each browser Yoqa can launch, one per installed browser. */
export type InstalledBrowserId = "web-chrome" | "web-edge" | "web-brave" | "web-chromium";

export type InstalledBrowser = {
	id: InstalledBrowserId;
	name: string;
	/** `CFBundleShortVersionString`, or null when the bundle names none. */
	version: string | null;
	executable: string;
};

/** Each browser's app bundle and the binary inside it, in listing order. */
const KNOWN_BROWSERS: ReadonlyArray<{ id: InstalledBrowserId; name: string; app: string }> = [
	{ id: "web-chrome", name: "Google Chrome", app: "Google Chrome" },
	{ id: "web-edge", name: "Microsoft Edge", app: "Microsoft Edge" },
	{ id: "web-brave", name: "Brave Browser", app: "Brave Browser" },
	{ id: "web-chromium", name: "Chromium", app: "Chromium" },
];

/** The installed-browser id a device id names, or null when it is not one. */
export function installedBrowserIdOf(deviceId: string): InstalledBrowserId | null {
	return KNOWN_BROWSERS.find((browser) => browser.id === deviceId)?.id ?? null;
}

/** What discovery reads from the host, so tests can fake the filesystem. */
export type DiscoveryDeps = {
	platform: NodeJS.Platform;
	home: string;
	isExecutable: (path: string) => Promise<boolean>;
	readText: (path: string) => Promise<string>;
};

export function discoveryDeps(): DiscoveryDeps {
	return {
		platform: process.platform,
		home: homedir(),
		isExecutable: (path) =>
			access(path, constants.X_OK).then(
				() => true,
				() => false,
			),
		readText: (path) => readFile(path, "utf8"),
	};
}

const VERSION_RE = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/;

async function bundleVersion(appPath: string, deps: DiscoveryDeps): Promise<string | null> {
	const plist = await deps.readText(join(appPath, "Contents/Info.plist")).catch(() => "");
	return VERSION_RE.exec(plist)?.[1]?.trim() || null;
}

/**
 * The Chromium-family browsers installed on this Mac, whether running or not. A browser
 * in `/Applications` wins over a copy in `~/Applications`. Empty off macOS.
 */
export async function findInstalledBrowsers(
	deps: DiscoveryDeps = discoveryDeps(),
): Promise<InstalledBrowser[]> {
	if (deps.platform !== "darwin") return [];
	const roots = ["/Applications", join(deps.home, "Applications")];
	const found = await Promise.all(
		KNOWN_BROWSERS.map(async ({ id, name, app }) => {
			for (const root of roots) {
				const appPath = join(root, `${app}.app`);
				const executable = join(appPath, "Contents/MacOS", app);
				if (!(await deps.isExecutable(executable))) continue;
				return { id, name, version: await bundleVersion(appPath, deps), executable };
			}
			return null;
		}),
	);
	return found.filter((browser) => browser !== null);
}

/** Installed browsers with a Yoqa-owned instance running now. */
const running = new Set<InstalledBrowserId>();

/**
 * The installed browsers as web devices, listed whether running or not, the way shut-down
 * simulators are. A browser is `running` while Yoqa's own instance of it is up; without
 * unavailable devices, only those are listed.
 */
export async function listWebDevices(
	options: ListDevicesOptions = {},
	deps: DiscoveryDeps = discoveryDeps(),
): Promise<Device[]> {
	const includeUnavailable = options.includeUnavailable ?? true;
	const devices: Device[] = [];
	for (const browser of await findInstalledBrowsers(deps)) {
		const isRunning = running.has(browser.id);
		if (!includeUnavailable && !isRunning) continue;
		devices.push({
			id: browser.id,
			name: browser.name,
			osVersion: browser.version ?? "unknown version",
			platform: "web",
			kind: "browser",
			state: isRunning ? "running" : "not running",
		});
	}
	return devices;
}

/** The launched browser process, as `launchChromium` uses it. */
export type BrowserProcess = {
	exited: Promise<number>;
	stderr: ReadableStream<Uint8Array> | null;
	kill: (signal?: NodeJS.Signals) => void;
};

/** A browser Yoqa launched and owns. */
export type ChromiumInstance = {
	/** The browser's CDP WebSocket URL. */
	socketUrl: string;
	profileDir: string;
	/** Resolves when the browser process exits, for whatever reason. */
	exited: Promise<number>;
	/** Kill the browser, and delete its profile if it is a clean one. Safe to call twice. */
	stop: () => Promise<void>;
};

export type LaunchDeps = {
	spawn?: (command: string[]) => BrowserProcess;
	readyTimeoutMs?: number;
	/** The home folder `~/.yoqa` is under. */
	home?: string;
	/** Whether a process with this pid runs on this machine. */
	isProcessAlive?: (pid: number) => boolean;
};

/** Which profile a launch uses: its App's Kept profile (the default) or a clean one. */
export type ProfileRequest = {
	profile?: BrowserProfile;
	/** The App whose Kept profile it is; `default` when none is named. */
	appId?: string;
};

/** The Kept profile's App folder when a connect names no App. */
export const DEFAULT_PROFILE_APP = "default";

/** The Kept profile of `browserId` for `appId`, under `home`. */
export function keptProfileDir(
	browserId: InstalledBrowserId,
	appId: string = DEFAULT_PROFILE_APP,
	home: string = homedir(),
): string {
	// One plain folder name, so a Kept profile stays under its root.
	if (!PROFILE_APP_ID_PATTERN.test(appId)) {
		throw new Error(`${appId} is not an App id a browser profile can be kept for`);
	}
	return join(home, ".yoqa", "browser-profiles", appId, browserId);
}

/** A Kept profile another live browser has open, so Yoqa cannot launch on it. */
export class ProfileInUseError extends Error {
	constructor(profileDir: string, pid: number) {
		super(
			`The browser profile ${profileDir} is in use by another browser (pid ${pid}). Quit that browser and connect again`,
		);
		this.name = "ProfileInUseError";
	}
}

/** What Chromium leaves in a profile it has open, and after a crash. */
const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: alive, but someone else's.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Clear the locks a browser that crashed left in `profileDir`, or fail when a live one
 * holds it. Chromium's `SingletonLock` points at `<hostname>-<pid>`; a lock from another
 * host, or from a pid that is gone, is stale.
 */
async function clearStaleLock(profileDir: string, alive: (pid: number) => boolean): Promise<void> {
	const owner = await readlink(join(profileDir, "SingletonLock")).catch(() => null);
	const match = owner ? /^(.*)-(\d+)$/.exec(owner) : null;
	const pid = Number(match?.[2]);
	if (match?.[1] === hostname() && pid > 0 && alive(pid)) {
		throw new ProfileInUseError(profileDir, pid);
	}
	await Promise.all(LOCK_FILES.map((lock) => rm(join(profileDir, lock), { force: true })));
}

/**
 * The profile folder a launch uses, ready for the browser: a clean one made fresh, or the
 * Kept one made if missing, with stale locks cleared and the last browser's port file gone.
 */
async function prepareProfile(
	browser: InstalledBrowser,
	request: ProfileRequest,
	deps: LaunchDeps,
): Promise<{ profileDir: string; clean: boolean }> {
	if (request.profile === "clean") {
		return { profileDir: await mkdtemp(join(tmpdir(), "yoqa-web-")), clean: true };
	}
	const profileDir = keptProfileDir(browser.id, request.appId, deps.home);
	await mkdir(profileDir, { recursive: true });
	await clearStaleLock(profileDir, deps.isProcessAlive ?? isProcessAlive);
	await rm(join(profileDir, "DevToolsActivePort"), { force: true });
	return { profileDir, clean: false };
}

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 50;
const STOP_GRACE_MS = 2_000;

/**
 * Flags for a Yoqa-owned instance: no first-run, default-browser or search-engine screens,
 * no sync, and a mock keychain so macOS never asks for the login password.
 */
const LAUNCH_FLAGS = [
	"--remote-debugging-port=0",
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-search-engine-choice-screen",
	"--disable-sync",
	"--disable-default-apps",
	"--use-mock-keychain",
	"--password-store=basic",
];

function spawnBrowser(command: string[]): BrowserProcess {
	return Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
}

/** The port and socket path from `DevToolsActivePort`, or null until the browser wrote both. */
async function readActivePort(profileDir: string): Promise<string | null> {
	const text = await readFile(join(profileDir, "DevToolsActivePort"), "utf8").catch(() => "");
	const [port, path] = text.split("\n").map((line) => line.trim());
	if (!port || !/^\d+$/.test(port) || !path?.startsWith("/")) return null;
	return `ws://127.0.0.1:${port}${path}`;
}

/**
 * Launch `browser` on its App's Kept profile, or a clean one, with
 * `--remote-debugging-port=0`, and resolve once it has written the port it picked to the
 * profile's `DevToolsActivePort`. A browser that exits or stays silent first is killed, a
 * clean profile deleted, and the launch fails.
 */
export async function launchChromium(
	browser: InstalledBrowser,
	deps: LaunchDeps = {},
	request: ProfileRequest = {},
): Promise<ChromiumInstance> {
	const spawn = deps.spawn ?? spawnBrowser;
	const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
	const { profileDir, clean } = await prepareProfile(browser, request, deps);
	const removeProfile = async () => {
		if (clean) await rm(profileDir, { recursive: true, force: true });
	};

	let proc: BrowserProcess;
	try {
		proc = spawn([
			browser.executable,
			`--user-data-dir=${profileDir}`,
			...LAUNCH_FLAGS,
			"about:blank",
		]);
	} catch (error) {
		await removeProfile();
		throw error;
	}
	let hasExited = false;
	const exited = proc.exited.then((code) => {
		hasExited = true;
		running.delete(browser.id);
		return code;
	});
	const stderr = proc.stderr ? new Response(proc.stderr).text().catch(() => "") : null;

	let stopping: Promise<void> | null = null;
	const stop = () => {
		stopping ??= (async () => {
			if (!hasExited) {
				proc.kill("SIGTERM");
				const exitedInTime = await Promise.race([
					exited.then(() => true),
					Bun.sleep(STOP_GRACE_MS).then(() => false),
				]);
				if (!exitedInTime) proc.kill("SIGKILL");
			}
			running.delete(browser.id);
			await removeProfile();
		})();
		return stopping;
	};

	const deadline = Date.now() + readyTimeoutMs;
	while (true) {
		const socketUrl = await readActivePort(profileDir);
		if (socketUrl) {
			running.add(browser.id);
			return { socketUrl, profileDir, exited, stop };
		}
		if (hasExited) {
			await stop();
			const output = ((await stderr) ?? "").trim();
			throw new Error(
				`${browser.name} exited before it opened a debug port${output ? `: ${output}` : ""}`,
			);
		}
		if (Date.now() >= deadline) {
			await stop();
			throw new Error(`${browser.name} did not open a debug port within ${readyTimeoutMs} ms`);
		}
		await Promise.race([exited, Bun.sleep(READY_POLL_MS)]);
	}
}
