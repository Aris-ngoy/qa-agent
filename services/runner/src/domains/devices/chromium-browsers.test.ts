import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	type BrowserProcess,
	type DiscoveryDeps,
	findInstalledBrowsers,
	installedBrowserIdOf,
	launchChromium,
	listWebDevices,
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

	test("starts the browser on a fresh temporary profile and a free debug port", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(CHROME, { spawn: chromium.spawn });
		const [command] = chromium.launched;
		expect(command?.[0]).toBe(CHROME.executable);
		expect(command).toContain(`--user-data-dir=${instance.profileDir}`);
		expect(command).toContain("--remote-debugging-port=0");
		expect(command).toContain("--no-first-run");
		expect(command).toContain("--no-default-browser-check");
		expect(instance.profileDir).not.toContain("Library/Application Support");
		expect(existsSync(instance.profileDir)).toBe(true);
		// The port the browser picked, read back from its DevToolsActivePort file.
		expect(instance.socketUrl).toBe(
			`ws://127.0.0.1:${chromium.browsers[0]?.port}/devtools/browser/fake`,
		);
		await instance.stop();
	});

	test("each launch gets its own profile", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const first = await launchChromium(CHROME, { spawn: chromium.spawn });
		const second = await launchChromium(CHROME, { spawn: chromium.spawn });
		expect(first.profileDir).not.toBe(second.profileDir);
		await first.stop();
		await second.stop();
	});

	test("stop kills the browser and deletes its profile", async () => {
		const chromium = fakeChromium({ viewport: { width: 1280, height: 800 } });
		const instance = await launchChromium(CHROME, { spawn: chromium.spawn });
		await instance.stop();
		expect(chromium.kills).toBe(1);
		expect(existsSync(instance.profileDir)).toBe(false);
		await instance.stop();
		expect(chromium.kills).toBe(1);
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
		const error = await rejection(launchChromium(CHROME, { spawn }));
		expect((error as Error).message).toContain(
			"Google Chrome exited before it opened a debug port",
		);
		expect((error as Error).message).toContain("Trace/BPT trap: 5");
		expect(existsSync(profile)).toBe(false);
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
		const error = await rejection(launchChromium(CHROME, { spawn, readyTimeoutMs: 100 }));
		expect((error as Error).message).toContain("did not open a debug port within 100 ms");
		expect(kills).toBe(1);
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
		const instance = await launchChromium(chrome, { spawn: chromium.spawn });
		const running = await listWebDevices({ includeUnavailable: false }, installed);
		expect(running.map((device) => [device.id, device.state])).toEqual([["web-chrome", "running"]]);
		await instance.stop();
		expect(await listWebDevices({ includeUnavailable: false }, installed)).toEqual([]);
	});

	test("nothing is listed when no browser is installed", async () => {
		expect(await listWebDevices({}, mac({}))).toEqual([]);
	});
});
