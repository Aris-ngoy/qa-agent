import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryDeps } from "./chromium-browsers";
import {
	type EverydayBrowser,
	EverydayConnectError,
	type ProcessDeps,
	everydayBrowserIdOf,
	findEverydayBrowsers,
	listEverydayDevices,
	openEverydaySocket,
	readEverydayProfileName,
} from "./chromium-everyday";
import { type FakeCdp, startFakeCdp } from "./fake-cdp";

const VIEWPORT = { width: 1280, height: 800 };

const homes: string[] = [];
const browsers: FakeCdp[] = [];

afterEach(() => {
	for (const browser of browsers.splice(0)) browser.kill();
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** An app's binary in `/Applications`. */
function binary(app: string): string {
	return `/Applications/${app}.app/Contents/MacOS/${app}`;
}

/**
 * A Mac home with these app bundles installed, on the real filesystem, and the user's own
 * instance of each app in `running` up (all of them unless named).
 */
function mac(
	apps: string[],
	running: string[] = apps,
): DiscoveryDeps & ProcessDeps & { home: string } {
	const home = mkdtempSync(join(tmpdir(), "yoqa-everyday-"));
	homes.push(home);
	return {
		platform: "darwin",
		home,
		isExecutable: async (path) => apps.some((app) => path.startsWith(`/Applications/${app}.app/`)),
		readText: (path) => Bun.file(path).text(),
		processArgs: async () => running.map((app) => `${binary(app)} --flag-switches-begin`),
	};
}

/** The browser writes `DevToolsActivePort` in its default user-data folder, under `home`. */
function writePort(home: string, userData: string, port: number, path = "/devtools/browser/abc") {
	const dir = join(home, "Library/Application Support", userData);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "DevToolsActivePort"), `${port}\n${path}\n`);
	return dir;
}

/** A browser with the remote-debugging toggle on: `/json/*` is 404 and sockets ask first. */
function consentBrowser(): FakeCdp {
	const browser = startFakeCdp({ viewport: VIEWPORT, consent: true });
	browsers.push(browser);
	return browser;
}

/** A port nothing listens on. */
function closedPort(): number {
	const server = Bun.serve({ port: 0, fetch: () => new Response("") });
	const port = server.port ?? 0;
	server.stop(true);
	return port;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error: unknown) => error,
	);
}

describe("Everyday browser discovery", () => {
	test("each installed browser has an everyday device, with its own default user-data folder", async () => {
		const deps = mac(["Google Chrome", "Dia", "Microsoft Edge"]);
		const found = await findEverydayBrowsers(deps);
		expect(found.map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: "web-chrome-everyday", name: "Google Chrome" },
			{ id: "web-edge-everyday", name: "Microsoft Edge" },
			{ id: "web-dia-everyday", name: "Dia" },
		]);
		const dirs = Object.fromEntries(found.map((browser) => [browser.id, browser.userDataDir]));
		expect(dirs["web-chrome-everyday"]).toBe(
			join(deps.home, "Library/Application Support/Google/Chrome"),
		);
		expect(dirs["web-dia-everyday"]).toBe(
			join(deps.home, "Library/Application Support/Dia/User Data"),
		);
	});

	test("Arc, Opera and Vivaldi have everyday devices, unverified, in their own folders", async () => {
		const deps = mac(["Vivaldi", "Opera", "Arc", "Google Chrome"]);
		const found = await findEverydayBrowsers(deps);
		const support = join(deps.home, "Library/Application Support");
		expect(found.map(({ id, name, userDataDir }) => [id, name, userDataDir])).toEqual([
			["web-chrome-everyday", "Google Chrome", join(support, "Google/Chrome")],
			["web-arc-everyday", "Arc", join(support, "Arc/User Data")],
			["web-opera-everyday", "Opera", join(support, "com.operasoftware.Opera")],
			["web-vivaldi-everyday", "Vivaldi", join(support, "Vivaldi")],
		]);
		const devices = await listEverydayDevices({}, deps);
		expect(devices.map((device) => [device.id, device.verified])).toEqual([
			["web-chrome-everyday", true],
			["web-arc-everyday", false],
			["web-opera-everyday", false],
			["web-vivaldi-everyday", false],
		]);
	});

	test("Arc, Opera and Vivaldi are off without a port file, and ready with one in their folder", async () => {
		const deps = mac(["Arc", "Opera", "Vivaldi"]);
		const off = await listEverydayDevices({}, deps);
		expect(off.map((device) => device.state)).toEqual([
			"remote debugging off",
			"remote debugging off",
			"remote debugging off",
		]);
		for (const userData of ["Arc/User Data", "com.operasoftware.Opera", "Vivaldi"]) {
			writePort(deps.home, userData, consentBrowser().port);
		}
		const ready = await listEverydayDevices({}, deps);
		expect(ready.map((device) => device.state)).toEqual(["ready", "ready", "ready"]);
	});

	test("a folder with a port file and a port that answers is ready", async () => {
		const deps = mac(["Google Chrome"]);
		const browser = consentBrowser();
		writePort(deps.home, "Google/Chrome", browser.port);
		expect(await listEverydayDevices({}, deps)).toEqual([
			{
				id: "web-chrome-everyday",
				name: "Google Chrome (everyday)",
				osVersion: "everyday browser",
				platform: "web",
				kind: "browser",
				state: "ready",
				verified: true,
			},
		]);
	});

	test("no port file, with the browser running, is remote debugging off", async () => {
		const deps = mac(["Google Chrome"]);
		const [device] = await listEverydayDevices({}, deps);
		expect(device?.state).toBe("remote debugging off");
	});

	test("a stale port file, with the browser running and nothing on its port, is remote debugging off", async () => {
		const deps = mac(["Dia"]);
		writePort(deps.home, "Dia/User Data", closedPort());
		const [device] = await listEverydayDevices({}, deps);
		expect(device).toMatchObject({ id: "web-dia-everyday", state: "remote debugging off" });
	});

	test("a closed browser is not running, with or without a stale port file", async () => {
		const deps = mac(["Google Chrome", "Dia"], []);
		writePort(deps.home, "Google/Chrome", closedPort());
		const devices = await listEverydayDevices({}, deps);
		expect(devices.map((device) => [device.id, device.state])).toEqual([
			["web-chrome-everyday", "not running"],
			["web-dia-everyday", "not running"],
		]);
	});

	test("a browser Yoqa launched on a Kept profile is not the user's own running", async () => {
		const deps = {
			...mac(["Dia"], []),
			processArgs: async () => [`${binary("Dia")} --user-data-dir=/kept --remote-debugging-port=0`],
		};
		const [device] = await listEverydayDevices({}, deps);
		expect(device?.state).toBe("not running");
	});

	test("a host whose processes cannot be read counts the browser as running", async () => {
		const deps = {
			...mac(["Dia"], []),
			processArgs: () => Promise.reject(new Error("ps: not found")),
		};
		const [device] = await listEverydayDevices({}, deps);
		expect(device?.state).toBe("remote debugging off");
	});

	test("listing booted devices only lists only the ready ones", async () => {
		const deps = mac(["Google Chrome", "Dia", "Microsoft Edge"], ["Google Chrome", "Dia"]);
		const browser = consentBrowser();
		writePort(deps.home, "Dia/User Data", browser.port);
		const devices = await listEverydayDevices({ includeUnavailable: false }, deps);
		expect(devices.map((device) => device.id)).toEqual(["web-dia-everyday"]);
	});

	test("discovery never opens a WebSocket, which would raise the Allow prompt", async () => {
		const deps = mac(["Google Chrome"]);
		const browser = consentBrowser();
		writePort(deps.home, "Google/Chrome", browser.port);
		await listEverydayDevices({}, deps);
		expect(browser.socketRequests()).toBe(0);
	});

	test("discovery is macOS only", async () => {
		expect(await findEverydayBrowsers({ ...mac(["Google Chrome"]), platform: "linux" })).toEqual(
			[],
		);
	});

	test("an everyday device id names its browser", () => {
		expect(everydayBrowserIdOf("web-dia-everyday")).toBe("web-dia-everyday");
		expect(everydayBrowserIdOf("web-chrome")).toBeNull();
		expect(everydayBrowserIdOf("web-firefox-everyday")).toBeNull();
	});
});

describe("Everyday browser connect", () => {
	function chrome(port: number): EverydayBrowser & { home: string } {
		const deps = mac([]);
		return {
			id: "web-chrome-everyday",
			name: "Google Chrome",
			userDataDir: writePort(deps.home, "Google/Chrome", port, "/devtools/browser/fake"),
			executable: binary("Google Chrome"),
			home: deps.home,
		};
	}

	/** Chrome's port file names nothing, with Chrome itself running or not. */
	function chromeWithoutPortFile(): EverydayBrowser {
		const deps = mac([]);
		return {
			id: "web-chrome-everyday",
			name: "Google Chrome",
			userDataDir: join(deps.home, "Library/Application Support/Google/Chrome"),
			executable: binary("Google Chrome"),
		};
	}

	const read = (path: string) => Bun.file(path).text();
	const chromeRunning: ProcessDeps = { processArgs: async () => [binary("Google Chrome")] };
	const nothingRunning: ProcessDeps = { processArgs: async () => [] };

	test("waits for a socket that opens late, when the user clicks Allow", async () => {
		const browser = consentBrowser();
		const opening = openEverydaySocket(chrome(browser.port), {
			readText: (path) => Bun.file(path).text(),
		});
		await Bun.sleep(150);
		browser.allow();
		const client = await opening;
		expect((await client.send("Browser.getVersion", {})).product).toContain("Chrome");
		expect(browser.socketRequests()).toBe(1);
		await client.close();
	});

	test("a socket that fails before it opens is a Deny, attempted once", async () => {
		const browser = consentBrowser();
		const opening = rejection(
			openEverydaySocket(chrome(browser.port), { readText: (path) => Bun.file(path).text() }),
		);
		await Bun.sleep(50);
		browser.deny();
		const error = await opening;
		expect(error).toBeInstanceOf(EverydayConnectError);
		expect((error as Error).message).toBe("Remote debugging was denied in Google Chrome");
		await Bun.sleep(100);
		expect(browser.socketRequests()).toBe(1);
	});

	test("no answer within the deadline fails with the timeout message, attempted once", async () => {
		const browser = consentBrowser();
		const error = await rejection(
			openEverydaySocket(chrome(browser.port), {
				readText: (path) => Bun.file(path).text(),
				allowTimeoutMs: 100,
			}),
		);
		expect((error as Error).message).toBe(
			"Google Chrome did not answer the Allow prompt within 0.1 s",
		);
		await Bun.sleep(100);
		expect(browser.socketRequests()).toBe(1);
	});

	test("the wait is cancellable", async () => {
		const browser = consentBrowser();
		const controller = new AbortController();
		const opening = rejection(
			openEverydaySocket(chrome(browser.port), {
				readText: (path) => Bun.file(path).text(),
				signal: controller.signal,
			}),
		);
		await Bun.sleep(50);
		controller.abort();
		expect(((await opening) as Error).message).toBe(
			"The connect to Google Chrome was cancelled before Allow",
		);
		expect(browser.socketRequests()).toBe(1);
	});

	test("no port file, with the browser running, fails saying where to turn remote debugging on", async () => {
		const error = await rejection(
			openEverydaySocket(chromeWithoutPortFile(), { readText: read, ...chromeRunning }),
		);
		expect((error as Error).message).toBe(
			"Remote debugging is off in Google Chrome. Turn it on at chrome://inspect/#remote-debugging, then connect again",
		);
	});

	test("a closed browser fails saying to open it, without a socket", async () => {
		const connect = mock(() => Promise.reject(new Error("no socket expected")));
		const error = await rejection(
			openEverydaySocket(chrome(closedPort()), { readText: read, connect, ...nothingRunning }),
		);
		expect(error).toBeInstanceOf(EverydayConnectError);
		expect((error as Error).message).toBe(
			"Google Chrome is not running. Open it, turn on remote debugging at chrome://inspect/#remote-debugging, then connect again",
		);
		expect(connect).not.toHaveBeenCalled();
	});

	test("a stale port file, with the browser running, is remote debugging off, without a socket", async () => {
		const connect = mock(() => Promise.reject(new Error("no socket expected")));
		const error = await rejection(
			openEverydaySocket(chrome(closedPort()), { readText: read, connect, ...chromeRunning }),
		);
		expect((error as Error).message).toStartWith("Remote debugging is off in Google Chrome.");
		expect(connect).not.toHaveBeenCalled();
	});
});

describe("Everyday browser profile name", () => {
	const read = (path: string) => Bun.file(path).text();

	test("is the last-used profile's name from Local State", async () => {
		const dir = mkdtempSync(join(tmpdir(), "yoqa-local-state-"));
		homes.push(dir);
		writeFileSync(
			join(dir, "Local State"),
			JSON.stringify({
				profile: {
					last_used: "Profile 1",
					info_cache: { Default: { name: "Personal" }, "Profile 1": { name: "Work" } },
				},
			}),
		);
		expect(await readEverydayProfileName(dir, read)).toBe("Work");
	});

	test("is the Default profile's name when none was last used", async () => {
		const dir = mkdtempSync(join(tmpdir(), "yoqa-local-state-"));
		homes.push(dir);
		writeFileSync(
			join(dir, "Local State"),
			JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }),
		);
		expect(await readEverydayProfileName(dir, read)).toBe("Personal");
	});

	test("is null when Local State is missing or unreadable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "yoqa-local-state-"));
		homes.push(dir);
		expect(await readEverydayProfileName(dir, read)).toBeNull();
		writeFileSync(join(dir, "Local State"), "{not json");
		expect(await readEverydayProfileName(dir, read)).toBeNull();
	});
});
