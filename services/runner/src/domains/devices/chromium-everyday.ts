/**
 * The Everyday browser (ADR-0009): the user's own running Chromium browser, on its default
 * profile, attached by consent. With the toggle at `chrome://inspect/#remote-debugging` on,
 * the browser writes `DevToolsActivePort` in its default user-data folder and answers only
 * its browser WebSocket (`/json/*` is 404), and each new socket waits until the user clicks
 * Allow. Yoqa never launches, quits or reconfigures it. Discovery is macOS only.
 *
 * Discovery never opens a WebSocket, since that raises the Allow prompt: a browser is ready
 * when its port file names a port that gives any HTTP answer. A stale file, which Dia leaves
 * behind, names a port nothing answers on.
 */

import { join } from "node:path";
import {
	type Device,
	type EverydayBrowserId,
	WEB_BROWSERS,
	type WebBrowserKey,
	everydayBrowserId,
} from "@yoqa/runner-client";
import { type CdpClient, CdpOpenError, type ConnectCdpOptions, connectCdp } from "./cdp-client";
import { type DiscoveryDeps, discoveryDeps } from "./chromium-browsers";
import type { ListDevicesOptions } from "./models";

export type { EverydayBrowserId };

export type EverydayBrowser = {
	id: EverydayBrowserId;
	name: string;
	/** The browser's default user-data folder, where its port file and `Local State` are. */
	userDataDir: string;
};

/**
 * Each browser's default user-data folder under `~/Library/Application Support`. Dia and
 * Arc keep their profiles one level down, under `User Data`. Arc's, Opera's and Vivaldi's
 * are from #349 and the vendors' layouts, not yet checked on an install.
 */
const USER_DATA_DIRS: Record<WebBrowserKey, string> = {
	chrome: "Google/Chrome",
	edge: "Microsoft Edge",
	brave: "BraveSoftware/Brave-Browser",
	chromium: "Chromium",
	dia: "Dia/User Data",
	arc: "Arc/User Data",
	opera: "com.operasoftware.Opera",
	vivaldi: "Vivaldi",
};

/** Each browser's app bundle (`<name>.app`) and user-data folder, in listing order. */
const EVERYDAY_BROWSERS = WEB_BROWSERS.map(({ browser, name, verified }) => ({
	id: everydayBrowserId(browser),
	name,
	app: name,
	verified,
	userData: USER_DATA_DIRS[browser],
}));

/** The Everyday browser id a device id names, or null when it is not one. */
export function everydayBrowserIdOf(deviceId: string): EverydayBrowserId | null {
	return EVERYDAY_BROWSERS.find((browser) => browser.id === deviceId)?.id ?? null;
}

/** The browsers installed on this Mac, each as its Everyday browser. Empty off macOS. */
export async function findEverydayBrowsers(
	deps: DiscoveryDeps = discoveryDeps(),
): Promise<EverydayBrowser[]> {
	if (deps.platform !== "darwin") return [];
	const roots = ["/Applications", join(deps.home, "Applications")];
	const found = await Promise.all(
		EVERYDAY_BROWSERS.map(async ({ id, name, app, userData }) => {
			for (const root of roots) {
				if (!(await deps.isExecutable(join(root, `${app}.app`, "Contents/MacOS", app)))) continue;
				return { id, name, userDataDir: join(deps.home, "Library/Application Support", userData) };
			}
			return null;
		}),
	);
	return found.filter((browser) => browser !== null);
}

/** The port and browser socket path a browser wrote to its `DevToolsActivePort`. */
type ActivePort = { port: number; path: string };

async function readActivePort(
	browser: EverydayBrowser,
	readText: DiscoveryDeps["readText"],
): Promise<ActivePort | null> {
	const text = await readText(join(browser.userDataDir, "DevToolsActivePort")).catch(() => "");
	const [port, path] = text.split("\n").map((line) => line.trim());
	const number = Number(port);
	if (!/^\d+$/.test(port ?? "") || number < 1 || number > 65_535 || !path?.startsWith("/")) {
		return null;
	}
	return { port: number, path };
}

const PROBE_TIMEOUT_MS = 1_000;

/** Whether anything answers HTTP on `port`: a 404 is the toggle's answer, so any status counts. */
async function portAnswers(port: number, fetchFn: typeof fetch): Promise<boolean> {
	return fetchFn(`http://127.0.0.1:${port}/json/version`, {
		signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
	}).then(
		() => true,
		() => false,
	);
}

export type EverydayState = "ready" | "remote debugging off";

/**
 * The installed browsers' Everyday browsers as web devices: `ready` when remote debugging
 * answers, else `remote debugging off`, which listing booted devices only leaves out.
 */
export async function listEverydayDevices(
	options: ListDevicesOptions = {},
	deps: DiscoveryDeps & { fetch?: typeof fetch } = discoveryDeps(),
): Promise<Device[]> {
	const includeUnavailable = options.includeUnavailable ?? true;
	const browsers = await findEverydayBrowsers(deps);
	const devices = await Promise.all(
		browsers.map(async (browser): Promise<Device> => {
			const active = await readActivePort(browser, deps.readText);
			const ready = active !== null && (await portAnswers(active.port, deps.fetch ?? fetch));
			const state: EverydayState = ready ? "ready" : "remote debugging off";
			return {
				id: browser.id,
				name: `${browser.name} (everyday)`,
				osVersion: "everyday browser",
				platform: "web",
				kind: "browser",
				state,
				verified: EVERYDAY_BROWSERS.some(({ id, verified }) => id === browser.id && verified),
			};
		}),
	);
	return devices.filter((device) => includeUnavailable || device.state === "ready");
}

/** How long a connect waits for the user's Allow. */
export const ALLOW_TIMEOUT_MS = 60_000;

/** The Everyday browser's socket did not open: remote debugging off, Deny, no answer, or cancelled. */
export class EverydayConnectError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EverydayConnectError";
	}
}

export type EverydayConnectDeps = {
	readText: DiscoveryDeps["readText"];
	/** Open a CDP client on the browser socket. */
	connect?: (url: string, options: ConnectCdpOptions) => Promise<CdpClient>;
	/** How long to wait for Allow; 60 s by default. */
	allowTimeoutMs?: number;
	/** Cancels the wait. */
	signal?: AbortSignal;
};

function seconds(ms: number): string {
	return `${Number((ms / 1000).toFixed(3))} s`;
}

/**
 * Open the browser socket from the Everyday browser's port file, once, waiting up to
 * `allowTimeoutMs` for the user's Allow. It is never retried: each attempt prompts again.
 */
export async function openEverydaySocket(
	browser: EverydayBrowser,
	deps: EverydayConnectDeps,
): Promise<CdpClient> {
	const active = await readActivePort(browser, deps.readText);
	if (!active) {
		throw new EverydayConnectError(
			`Remote debugging is off in ${browser.name}. Turn it on at chrome://inspect/#remote-debugging, then connect again`,
		);
	}
	const allowTimeoutMs = deps.allowTimeoutMs ?? ALLOW_TIMEOUT_MS;
	const connect = deps.connect ?? connectCdp;
	try {
		return await connect(`ws://127.0.0.1:${active.port}${active.path}`, {
			connectTimeoutMs: allowTimeoutMs,
			signal: deps.signal,
		});
	} catch (error) {
		if (!(error instanceof CdpOpenError)) throw error;
		switch (error.reason) {
			case "refused":
				throw new EverydayConnectError(`Remote debugging was denied in ${browser.name}`);
			case "timeout":
				throw new EverydayConnectError(
					`${browser.name} did not answer the Allow prompt within ${seconds(allowTimeoutMs)}`,
				);
			case "aborted":
				throw new EverydayConnectError(`The connect to ${browser.name} was cancelled before Allow`);
		}
	}
}

type LocalState = {
	profile?: { last_used?: unknown; info_cache?: Record<string, { name?: unknown }> };
};

/**
 * The name of the profile a new window opens in, from the browser's `Local State`: the last
 * used one, `Default` when none is named. Null when it cannot be read.
 */
export async function readEverydayProfileName(
	userDataDir: string,
	readText: DiscoveryDeps["readText"],
): Promise<string | null> {
	const text = await readText(join(userDataDir, "Local State")).catch(() => "");
	let state: LocalState;
	try {
		state = JSON.parse(text) as LocalState;
	} catch {
		return null;
	}
	const lastUsed =
		typeof state.profile?.last_used === "string" ? state.profile.last_used : "Default";
	const name = state.profile?.info_cache?.[lastUsed]?.name;
	return typeof name === "string" && name ? name : null;
}
