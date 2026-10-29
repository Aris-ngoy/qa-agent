import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BrowserProcess,
	type DiscoveryDeps,
	ProfileInUseError,
	findInstalledBrowsers,
	installedBrowserIdOf,
	launchChromium,
	listWebDevices,
	resetKeptProfiles,
} from "./chromium-browsers";
import { fakeChromium, profileDirOf } from "./fake-cdp";

const HOME = "/Users/qa";

/** A Mac with these app bundles on disk, and Info.plist versions where given. */
function mac(apps: Record<string, string | null>): DiscoveryDeps {
	return {
		platform: "darwin",
		home: HOME,
		isExecutable: async (path) =>
			Object.keys(apps).some((app) => path.startsWith(`${app}/Contents/MacOS/`)),
		readText: async (path) => {
			const app = path.replace(/\/Contents\/Info\.plist$/, "");
			const version = apps[app];
			if (!version) throw new Error(`ENOENT: ${path}`);
			return `<plist><dict><key>CFBundleShortVersionString</key>\n\t<string>${version}</string></dict></plist>`;
		},
	};
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error: unknown) => error,
	);
}

describe("installed browser discovery", () => {
	test("lists each installed Chromium-family browser with a stable id, running or not", async () => {
		const browsers = await findInstalledBrowsers(
			mac({
				"/Applications/Google Chrome.app": "141.0.7390.55",
				"/Applications/Microsoft Edge.app": "141.0.3537.57",
				[`${HOME}/Applications/Brave Browser.app`]: "1.83.112",
				"/Applications/Chromium.app": null,
			}),
		);
		expect(browsers.map(({ id, name, version }) => ({ id, name, version }))).toEqual([
			{ id: "web-chrome", name: "Google Chrome", version: "141.0.7390.55" },
			{ id: "web-edge", name: "Microsoft Edge", version: "141.0.3537.57" },
			{ id: "web-brave", name: "Brave Browser", version: "1.83.112" },
			{ id: "web-chromium", name: "Chromium", version: null },
		]);
		expect(browsers[0]?.executable).toBe(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
		expect(browsers[2]?.executable).toBe(
			`${HOME}/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`,
		);
	});

	test("a browser in /Applications wins over a copy in ~/Applications", async () => {
		const browsers = await findInstalledBrowsers(
			mac({
				"/Applications/Google Chrome.app": "141.0",
				[`${HOME}/Applications/Google Chrome.app`]: "139.0",
			}),
		);
		expect(browsers).toHaveLength(1);
		expect(browsers[0]?.version).toBe("141.0");
	});

	test("nothing is listed when no browser is installed", async () => {
		expect(await findInstalledBrowsers(mac({}))).toEqual([]);
	});

	test("discovery is macOS only", async () => {
		const linux: DiscoveryDeps = {
			...mac({ "/Applications/Google Chrome.app": "141.0" }),
			platform: "linux",
		};
		expect(await findInstalledBrowsers(linux)).toEqual([]);
	});

	test("the device id names the browser", () => {
		expect(installedBrowserIdOf("web-chrome")).toBe("web-chrome");
		expect(installedBrowserIdOf("web-edge")).toBe("web-edge");
		expect(installedBrowserIdOf("web-firefox")).toBeNull();
		expect(installedBrowserIdOf("chromium-cdp-9222")).toBeNull();
	});
});

describe("launching a Yoqa-owned browser", () => {
	const CHROME = {
		id: "web-chrome" as const,
		name: "Google Chrome",
		version: "141.0",
		executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	};

	/** A temporary HOME, so a Kept profile never lands in the real one. */
	let home = "";
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "yoqa-home-"));
	});
	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});
	/** Whether a lock is there; a lock is a symlink to nothing, which `existsSync` misses. */
	const hasLock = (app: string, lock: string) =>
		lstatSync(join(keptDir(app), lock), { throwIfNoEntry: false }) !== undefined;
	const keptDir = (app: string) => join(home, ".yoqa", "browser-profiles", app, "web-chrome");

	test("starts the browser on its App's Kept profile and a free debug port", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home },
			{ appId: "app_1" },
		);
		const [command] = chromium.launched;
		expect(command?.[0]).toBe(CHROME.executable);
		expect(instance.profileDir).toBe(keptDir("app_1"));
		expect(command).toContain(`--user-data-dir=${keptDir("app_1")}`);
		expect(command).toContain("--remote-debugging-port=0");
		expect(command).toContain("--no-first-run");
		expect(command).toContain("--no-default-browser-check");
		expect(command).toContain("--use-mock-keychain");
		expect(command).toContain("--password-store=basic");
		expect(existsSync(instance.profileDir)).toBe(true);
		// The port the browser picked, read back from its DevToolsActivePort file.
		expect(instance.socketUrl).toBe(
			`ws://127.0.0.1:${chromium.browsers[0]?.port}/devtools/browser/fake`,
		);
		await instance.stop();
	});

	test("without an App the Kept profile is the default one", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(CHROME, { spawn: chromium.spawn, home });
		expect(instance.profileDir).toBe(keptDir("default"));
		await instance.stop();
	});

	test("stop kills the browser and keeps its Kept profile, which the next launch reuses", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const first = await launchChromium(CHROME, { spawn: chromium.spawn, home }, { appId: "app_1" });
		writeFileSync(join(first.profileDir, "Cookies"), "signed in");
		await first.stop();
		expect(chromium.kills).toBe(1);
		expect(existsSync(join(keptDir("app_1"), "Cookies"))).toBe(true);
		await first.stop();
		expect(chromium.kills).toBe(1);

		const second = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home },
			{ appId: "app_1" },
		);
		expect(second.profileDir).toBe(first.profileDir);
		expect(existsSync(join(second.profileDir, "Cookies"))).toBe(true);
		// The second browser's port, not the first one's left in the kept folder.
		expect(second.socketUrl).toBe(
			`ws://127.0.0.1:${chromium.browsers[1]?.port}/devtools/browser/fake`,
		);
		await second.stop();
	});

	test("each App and each browser has its own Kept profile", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const one = await launchChromium(CHROME, { spawn: chromium.spawn, home }, { appId: "app_1" });
		await one.stop();
		const two = await launchChromium(CHROME, { spawn: chromium.spawn, home }, { appId: "app_2" });
		await two.stop();
		const edge = await launchChromium(
			{ ...CHROME, id: "web-edge", name: "Microsoft Edge" },
			{ spawn: chromium.spawn, home },
			{ appId: "app_1" },
		);
		await edge.stop();
		expect([one.profileDir, two.profileDir, edge.profileDir]).toEqual([
			keptDir("app_1"),
			keptDir("app_2"),
			join(home, ".yoqa", "browser-profiles", "app_1", "web-edge"),
		]);
	});

	test("an App id that is not a folder name is refused", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const error = await rejection(
			launchChromium(CHROME, { spawn: chromium.spawn, home }, { appId: "../elsewhere" }),
		);
		expect((error as Error).message).toContain("../elsewhere");
		expect(chromium.launched).toEqual([]);
	});

	test("a clean profile is a temporary one, deleted on stop", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const first = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home },
			{ appId: "app_1", profile: "clean" },
		);
		const second = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home },
			{ appId: "app_1", profile: "clean" },
		);
		expect(first.profileDir).not.toBe(second.profileDir);
		expect(first.profileDir).not.toContain(".yoqa");
		expect(chromium.launched[0]).toContain(`--user-data-dir=${first.profileDir}`);
		expect(existsSync(first.profileDir)).toBe(true);
		await first.stop();
		await second.stop();
		expect(existsSync(first.profileDir)).toBe(false);
		expect(existsSync(second.profileDir)).toBe(false);
		expect(existsSync(keptDir("app_1"))).toBe(false);
	});

	test("a stale lock left by a browser that crashed is cleared, and the launch goes ahead", async () => {
		mkdirSync(keptDir("app_1"), { recursive: true });
		symlinkSync(`${hostname()}-4242`, join(keptDir("app_1"), "SingletonLock"));
		symlinkSync("/tmp/gone/SingletonSocket", join(keptDir("app_1"), "SingletonSocket"));
		symlinkSync("8361942", join(keptDir("app_1"), "SingletonCookie"));
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home, isProcessAlive: (pid) => pid !== 4242 },
			{ appId: "app_1" },
		);
		expect(chromium.launched).toHaveLength(1);
		for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
			expect(hasLock("app_1", lock)).toBe(false);
		}
		await instance.stop();
	});

	test("a Kept profile a live browser holds fails the launch, naming the folder", async () => {
		mkdirSync(keptDir("app_1"), { recursive: true });
		symlinkSync(`${hostname()}-4242`, join(keptDir("app_1"), "SingletonLock"));
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const error = await rejection(
			launchChromium(
				CHROME,
				{ spawn: chromium.spawn, home, isProcessAlive: (pid) => pid === 4242 },
				{ appId: "app_1" },
			),
		);
		expect(error).toBeInstanceOf(ProfileInUseError);
		expect((error as Error).message).toContain(keptDir("app_1"));
		expect((error as Error).message).toContain("4242");
		expect(chromium.launched).toEqual([]);
		expect(hasLock("app_1", "SingletonLock")).toBe(true);
	});

	test("a lock taken on another computer is stale here", async () => {
		mkdirSync(keptDir("app_1"), { recursive: true });
		symlinkSync("some-other-mac.local-4242", join(keptDir("app_1"), "SingletonLock"));
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(
			CHROME,
			{ spawn: chromium.spawn, home, isProcessAlive: () => true },
			{ appId: "app_1" },
		);
		expect(chromium.launched).toHaveLength(1);
		await instance.stop();
	});

	test("a browser that exits before it opens a debug port fails the launch, with its stderr", async () => {
		let profile = "";
		const spawn = (command: string[]): BrowserProcess => {
			profile = profileDirOf(command) ?? "";
			return {
				exited: Promise.resolve(1),
				stderr: new Response("Trace/BPT trap: 5\n").body as ReadableStream<Uint8Array>,
				kill: () => undefined,
			};
		};
		const error = await rejection(launchChromium(CHROME, { spawn, home }, { profile: "clean" }));
		expect((error as Error).message).toContain(
			"Google Chrome exited before it opened a debug port",
		);
		expect((error as Error).message).toContain("Trace/BPT trap: 5");
		expect(existsSync(profile)).toBe(false);
	});

	test("a failed launch keeps the Kept profile", async () => {
		const spawn = (): BrowserProcess => ({
			exited: Promise.resolve(1),
			stderr: null,
			kill: () => undefined,
		});
		await rejection(launchChromium(CHROME, { spawn, home }, { appId: "app_1" }));
		expect(existsSync(keptDir("app_1"))).toBe(true);
	});

	test("a browser that never opens a debug port is killed after the timeout", async () => {
		let kills = 0;
		let exit: (code: number) => void = () => undefined;
		const spawn = (): BrowserProcess => ({
			exited: new Promise((resolve) => {
				exit = resolve;
			}),
			stderr: null,
			kill: () => {
				kills += 1;
				exit(143);
			},
		});
		const error = await rejection(launchChromium(CHROME, { spawn, home, readyTimeoutMs: 100 }));
		expect((error as Error).message).toContain("did not open a debug port within 100 ms");
		expect(kills).toBe(1);
	});
});

describe("resetting a Kept profile", () => {
	let home = "";
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "yoqa-home-"));
	});
	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});
	const keptDir = (app: string, browser = "web-chrome") =>
		join(home, ".yoqa", "browser-profiles", app, browser);
	/** A Kept profile with a login in it. */
	const signedIn = (app: string, browser = "web-chrome") => {
		mkdirSync(keptDir(app, browser), { recursive: true });
		writeFileSync(join(keptDir(app, browser), "Cookies"), "signed in");
	};

	test("deletes one browser's Kept profile for the App, and keeps the others", async () => {
		signedIn("app_1");
		signedIn("app_1", "web-edge");
		signedIn("app_2");
		expect(await resetKeptProfiles({ appId: "app_1", browserId: "web-chrome" }, { home })).toEqual([
			"web-chrome",
		]);
		expect(existsSync(keptDir("app_1"))).toBe(false);
		expect(existsSync(keptDir("app_1", "web-edge"))).toBe(true);
		expect(existsSync(keptDir("app_2"))).toBe(true);
	});

	test("without a browser it deletes every browser's Kept profile for the App", async () => {
		signedIn("app_1");
		signedIn("app_1", "web-edge");
		signedIn("app_2");
		const reset = await resetKeptProfiles({ appId: "app_1" }, { home });
		expect(reset.sort()).toEqual(["web-chrome", "web-edge"]);
		expect(existsSync(join(home, ".yoqa", "browser-profiles", "app_1"))).toBe(false);
		expect(existsSync(keptDir("app_2"))).toBe(true);
	});

	test("without an App it is the default Kept profile", async () => {
		signedIn("default");
		expect(await resetKeptProfiles({}, { home })).toEqual(["web-chrome"]);
		expect(existsSync(keptDir("default"))).toBe(false);
	});

	test("a profile that is not there resets nothing", async () => {
		expect(await resetKeptProfiles({ appId: "app_1" }, { home })).toEqual([]);
		expect(await resetKeptProfiles({ appId: "app_1", browserId: "web-edge" }, { home })).toEqual(
			[],
		);
	});

	test("a profile a live browser holds is refused, and nothing is deleted", async () => {
		signedIn("app_1");
		signedIn("app_1", "web-edge");
		symlinkSync(`${hostname()}-4242`, join(keptDir("app_1", "web-edge"), "SingletonLock"));
		const error = await rejection(
			resetKeptProfiles({ appId: "app_1" }, { home, isProcessAlive: (pid) => pid === 4242 }),
		);
		expect(error).toBeInstanceOf(ProfileInUseError);
		expect((error as Error).message).toContain(keptDir("app_1", "web-edge"));
		expect(existsSync(join(keptDir("app_1"), "Cookies"))).toBe(true);
		expect(existsSync(join(keptDir("app_1", "web-edge"), "Cookies"))).toBe(true);
	});

	test("a stale lock does not stop a reset", async () => {
		signedIn("app_1");
		symlinkSync(`${hostname()}-4242`, join(keptDir("app_1"), "SingletonLock"));
		await resetKeptProfiles({ appId: "app_1" }, { home, isProcessAlive: () => false });
		expect(existsSync(keptDir("app_1"))).toBe(false);
	});

	test("an App id that is not a folder name is refused", async () => {
		signedIn("app_1");
		const error = await rejection(resetKeptProfiles({ appId: ".." }, { home }));
		expect((error as Error).message).toContain("..");
		expect(existsSync(keptDir("app_1"))).toBe(true);
	});
});

describe("web devices", () => {
	const installed = mac({
		"/Applications/Google Chrome.app": "141.0.7390.55",
		"/Applications/Chromium.app": null,
	});

	test("each installed browser is a browser device, listed while not running", async () => {
		expect(await listWebDevices({}, installed)).toEqual([
			{
				id: "web-chrome",
				name: "Google Chrome",
				osVersion: "141.0.7390.55",
				platform: "web",
				kind: "browser",
				state: "not running",
			},
			{
				id: "web-chromium",
				name: "Chromium",
				osVersion: "unknown version",
				platform: "web",
				kind: "browser",
				state: "not running",
			},
		]);
	});

	test("a browser Yoqa launched is running until it is stopped; booted-only lists just those", async () => {
		const [chrome] = await findInstalledBrowsers(installed);
		if (!chrome) throw new Error("Chrome is installed");
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const home = mkdtempSync(join(tmpdir(), "yoqa-home-"));
		const instance = await launchChromium(chrome, { spawn: chromium.spawn, home });
		const running = await listWebDevices({ includeUnavailable: false }, installed);
		expect(running.map((device) => [device.id, device.state])).toEqual([["web-chrome", "running"]]);
		await instance.stop();
		expect(await listWebDevices({ includeUnavailable: false }, installed)).toEqual([]);
		rmSync(home, { recursive: true, force: true });
	});

	test("nothing is listed when no browser is installed", async () => {
		expect(await listWebDevices({}, mac({}))).toEqual([]);
	});
});
