/**
 * How the web Direct lane reaches a Browser device and lets it go again. A web device id
 * names one of three ways in (`webDeviceOf`), and each is an adapter behind one interface:
 *
 * - **Launched** (`web-chrome`): Yoqa launches an installed browser on its App's Kept
 *   profile, or a clean one the connect asked for. Disconnecting quits it and keeps the
 *   Kept profile (a clean one is deleted). Restart clears the App origin's storage.
 * - **Everyday** (`web-chrome-everyday`, ADR-0009): the user's own browser, attached by
 *   consent over one socket from its port file. Yoqa never launches, quits or reconfigures
 *   it, and drives only a page in a window of its own: disconnecting closes that window and
 *   the socket. Restart clears nothing, which would sign the user out of their real account.
 * - **Attached by port** (`chromium-cdp-9222`, CLI/CI): a browser the user started with
 *   `--remote-debugging-port`. Disconnecting closes only the DevTools socket. Restart clears
 *   the App origin's storage: the profile is one the user prepared for testing.
 *
 * The session drives pages over the connection's client and never asks which way in it is.
 */

import { readFile } from "node:fs/promises";
import {
	type AppStorage,
	WEB_BROWSERS,
	installedBrowserId,
	webDeviceOf,
} from "@yoqa/runner-client";
import { type CdpClient, type ConnectCdpOptions, connectCdp } from "./cdp-client";
import { browserSocketUrl } from "./chromium-attach";
import {
	type BrowserProcess,
	type ChromiumInstance,
	type InstalledBrowser,
	type ProfileRequest,
	findInstalledBrowsers,
	launchChromium,
} from "./chromium-browsers";
import {
	type EverydayBrowser,
	findEverydayBrowsers,
	openEverydaySocket,
	readEverydayProfileName,
} from "./chromium-everyday";
import type { SessionOptions } from "./lane";

export type BrowserConnectionDeps = {
	/** The CDP WebSocket URL of the browser on `port`. */
	browserSocketUrl: (port: number) => Promise<string>;
	/** Open a CDP client on that URL. */
	connect: (url: string, options?: ConnectCdpOptions) => Promise<CdpClient>;
	/** The browsers installed on this machine. */
	installedBrowsers: () => Promise<InstalledBrowser[]>;
	/** Launch a Yoqa-owned instance of one, on the profile the connect asked for. */
	launch: (browser: InstalledBrowser, profile: ProfileRequest) => Promise<ChromiumInstance>;
	/** The installed browsers' Everyday browsers. */
	everydayBrowsers: () => Promise<EverydayBrowser[]>;
	/** Read a file in an Everyday browser's user-data folder. */
	readText: (path: string) => Promise<string>;
	/** How long an Everyday browser connect waits for Allow; 60 s by default. */
	allowTimeoutMs?: number;
	/** How long a launched browser may take to shut down on `Browser.close`; 5 s by default. */
	browserCloseGraceMs?: number;
};

export function browserConnectionDeps(
	overrides: {
		installedBrowsers?: () => Promise<InstalledBrowser[]>;
		spawn?: (command: string[]) => BrowserProcess;
		/** The home folder Kept profiles live under. */
		home?: string;
		/** Whether a pid holding a Kept profile's lock still runs. */
		isProcessAlive?: (pid: number) => boolean;
		everydayBrowsers?: () => Promise<EverydayBrowser[]>;
		allowTimeoutMs?: number;
		browserCloseGraceMs?: number;
	} = {},
): BrowserConnectionDeps {
	return {
		browserSocketUrl: (port) => browserSocketUrl(port),
		connect: (url, options) => connectCdp(url, options),
		installedBrowsers: overrides.installedBrowsers ?? (() => findInstalledBrowsers()),
		launch: (browser, profile) =>
			launchChromium(
				browser,
				{ spawn: overrides.spawn, home: overrides.home, isProcessAlive: overrides.isProcessAlive },
				profile,
			),
		everydayBrowsers: overrides.everydayBrowsers ?? (() => findEverydayBrowsers()),
		readText: (path) => readFile(path, "utf8"),
		allowTimeoutMs: overrides.allowTimeoutMs,
		browserCloseGraceMs: overrides.browserCloseGraceMs,
	};
}

/** What the session reports about the browser it is connected to. */
export type BrowserLabel = {
	/** `Google Chrome 141.0`, `Chrome 140.0.0.0`. */
	browser: string;
	/** The Everyday browser's profile Yoqa's window opened in; only an Everyday browser has one. */
	browserProfileName?: string | null;
};

/** A browser the session is connected to, by whichever way in its device id names. */
export type BrowserConnection = {
	/** The browser's CDP client: the session drives pages over it. */
	client: CdpClient;
	/**
	 * The page a new session drives: the browser's first page, or a blank one it opens. In
	 * the Everyday browser, always a blank page in a new window of Yoqa's own. Asked again
	 * when the page closes before the session could attach to it.
	 */
	firstPage: () => Promise<string>;
	/**
	 * A blank page to take over from the App's page, since closing the browser's last tab
	 * can quit it. In the Everyday browser, in a new window of Yoqa's own again.
	 */
	blankPage: () => Promise<string>;
	/** How the session names the browser. */
	label: () => Promise<BrowserLabel>;
	/** What restart-app does to the App origin's storage. */
	restartStorage: AppStorage;
	/** Settles when the browser process quits; never, for a browser Yoqa did not launch. */
	exited: Promise<unknown>;
	/** Session setup failed: let go of everything the connect opened. */
	abort: () => Promise<void>;
	/** The session died: let go of a browser Yoqa launched, without asking it anything. */
	abandon: () => void;
	/** Disconnect, given the pages the session opened or followed. */
	disconnect: (sessionPages: readonly string[]) => Promise<void>;
};

const BROWSER_CLOSE_GRACE_MS = 5_000;

/**
 * Never settles: a browser Yoqa did not launch has no process of Yoqa's to quit. One per
 * connection, so what waits on it goes with the connection.
 */
const never = () => new Promise<never>(() => {});

/** The browser's first page that is not DevTools, or a blank one it opens. */
async function firstPageOrBlank(client: CdpClient): Promise<string> {
	const { targetInfos } = await client.send("Target.getTargets", {});
	const page = targetInfos.find(
		(target) => target.type === "page" && !target.url.startsWith("devtools://"),
	);
	if (page) return page.targetId;
	return (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
}

async function blankTab(client: CdpClient): Promise<string> {
	return (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
}

/**
 * A browser Yoqa launched, on its App's Kept profile or a clean one. Disconnecting quits it
 * the way a user does, with `Browser.close`, so it writes its profile out: Chrome, Edge and
 * Opera save cookies only then, and stopped by a signal they lose the sign-ins a Kept
 * profile is for. One that has not quit within the grace is stopped by signal. Dia is quit
 * by signal only (`closesOverCdp`).
 */
export function launchedConnection(
	client: CdpClient,
	instance: ChromiumInstance,
	name: string,
	closeGraceMs = BROWSER_CLOSE_GRACE_MS,
): BrowserConnection {
	return {
		client,
		firstPage: () => firstPageOrBlank(client),
		blankPage: () => blankTab(client),
		label: async () => ({ browser: name }),
		restartStorage: "cleared",
		exited: instance.exited,
		abort: async () => {
			await client.close().catch(() => undefined);
			await instance.stop();
		},
		abandon: () => {
			void instance.stop();
		},
		disconnect: async () => {
			if (instance.closesOverCdp) {
				// It may close the socket before it answers.
				await client.send("Browser.close", {}).catch(() => undefined);
				await Promise.race([instance.exited, Bun.sleep(closeGraceMs)]);
			}
			await client.close();
			await instance.stop();
		},
	};
}

/** A browser the user started with a debug port. It stays open: only the socket closes. */
export function portConnection(client: CdpClient): BrowserConnection {
	return {
		client,
		firstPage: () => firstPageOrBlank(client),
		blankPage: () => blankTab(client),
		label: async () => ({
			browser: (await client.send("Browser.getVersion", {})).product.replace("/", " "),
		}),
		restartStorage: "cleared",
		exited: never(),
		abort: async () => {
			await client.close().catch(() => undefined);
		},
		abandon: () => undefined,
		disconnect: async () => {
			await client.close();
		},
	};
}

/**
 * The user's Everyday browser, attached by consent. Yoqa keeps to pages in windows of its
 * own and never lists, drives or closes the user's tabs, and the browser stays open: only
 * the pages the session opened or followed close, then the socket.
 */
export function everydayConnection(
	client: CdpClient,
	browser: Pick<EverydayBrowser, "name">,
	profileName: string | null,
): BrowserConnection {
	/** The window it opened for a session's first page, closed again when setup fails. */
	let ownTarget: string | null = null;
	const ownWindow = async () =>
		(await client.send("Target.createTarget", { url: "about:blank", newWindow: true })).targetId;
	return {
		client,
		firstPage: async () => {
			ownTarget = await ownWindow();
			return ownTarget;
		},
		blankPage: ownWindow,
		label: async () => {
			const { product } = await client.send("Browser.getVersion", {});
			return {
				browser: `${browser.name} ${product.split("/")[1] ?? ""}`.trim(),
				browserProfileName: profileName,
			};
		},
		// Clearing the origin in the Everyday browser would sign the user out of their real account.
		restartStorage: "kept",
		exited: never(),
		abort: async () => {
			if (ownTarget) {
				await client.send("Target.closeTarget", { targetId: ownTarget }).catch(() => undefined);
			}
			await client.close().catch(() => undefined);
		},
		abandon: () => undefined,
		disconnect: async (sessionPages) => {
			for (const targetId of sessionPages) {
				await client.send("Target.closeTarget", { targetId }).catch(() => undefined);
			}
			await client.close();
		},
	};
}

const INSTALLED_BROWSER_IDS = WEB_BROWSERS.map(({ browser }) => installedBrowserId(browser)).join(
	", ",
);

/** The error for a web device id that names nothing: the kinds of web device id there are. */
const WEB_DEVICE_ID_HINT = `A web device is an installed browser (${INSTALLED_BROWSER_IDS}), its Everyday browser (web-chrome-everyday, web-dia-everyday, …), or a Chromium started with --remote-debugging-port, named chromium-cdp-<port>`;

/**
 * Connect to the browser a web device id names, by the adapter for its way in: launch an
 * installed browser, attach to the user's Everyday browser by consent, or attach to a
 * user-started one by its port.
 */
export async function openBrowserConnection(
	{
		deviceId,
		appId,
		profile,
		signal,
	}: Pick<SessionOptions, "deviceId" | "appId" | "profile" | "signal">,
	deps: BrowserConnectionDeps,
): Promise<BrowserConnection> {
	const device = webDeviceOf(deviceId);
	switch (device?.kind) {
		case "port":
			return portConnection(await deps.connect(await deps.browserSocketUrl(device.port)));
		case "everyday": {
			const everydayId = device.id;
			const browser = (await deps.everydayBrowsers()).find((found) => found.id === everydayId);
			if (!browser) {
				throw new Error(
					`${everydayId} is not installed. Run yoqa devices web to list the browsers here`,
				);
			}
			const client = await openEverydaySocket(browser, {
				readText: deps.readText,
				connect: deps.connect,
				allowTimeoutMs: deps.allowTimeoutMs,
				signal,
			});
			const profileName = await readEverydayProfileName(browser.userDataDir, deps.readText);
			return everydayConnection(client, browser, profileName);
		}
		case "launched": {
			const browserId = device.id;
			const browser = (await deps.installedBrowsers()).find(
				(installed) => installed.id === browserId,
			);
			if (!browser) {
				throw new Error(
					`${browserId} is not installed. Run yoqa devices web to list the browsers here`,
				);
			}
			const instance = await deps.launch(browser, { appId, profile });
			const name = browser.version ? `${browser.name} ${browser.version}` : browser.name;
			const client = await deps.connect(instance.socketUrl).catch(async (error: unknown) => {
				await instance.stop();
				throw error;
			});
			return launchedConnection(client, instance, name, deps.browserCloseGraceMs);
		}
		case "unsupported":
			throw new Error(
				`Firefox and Safari are not supported yet: the web lane drives Chromium browsers over CDP (ADR-0010). ${WEB_DEVICE_ID_HINT}`,
			);
		default:
			throw new Error(WEB_DEVICE_ID_HINT);
	}
}
