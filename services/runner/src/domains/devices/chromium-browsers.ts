/**
 * Installed Chromium-family browsers (Chrome, Edge, Brave, Chromium) as web devices, and
 * the Yoqa-owned instance a connect launches (ADR-0007). Launching an installed browser is
 * to a web device what booting is to a simulator: a fresh temporary profile, a debug port
 * the browser picks itself, and no first-run screens. The user's own profile is never used.
 * Discovery is macOS only.
 */

import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "@yoqa/runner-client";
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
	/** Kill the browser and delete its profile. Safe to call twice. */
	stop: () => Promise<void>;
};

export type LaunchDeps = {
	spawn?: (command: string[]) => BrowserProcess;
	readyTimeoutMs?: number;
};

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 50;
const STOP_GRACE_MS = 2_000;

/**
 * Flags for a throwaway instance: no first-run, default-browser or search-engine screens,
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
 * Launch `browser` on a fresh temporary profile with `--remote-debugging-port=0`, and
 * resolve once it has written the port it picked to the profile's `DevToolsActivePort`.
 * A browser that exits or stays silent first is killed, its profile deleted, and the
 * launch fails.
 */
export async function launchChromium(
	browser: InstalledBrowser,
	deps: LaunchDeps = {},
): Promise<ChromiumInstance> {
	const spawn = deps.spawn ?? spawnBrowser;
	const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
	const profileDir = await mkdtemp(join(tmpdir(), "yoqa-web-"));
	const removeProfile = () => rm(profileDir, { recursive: true, force: true });

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
