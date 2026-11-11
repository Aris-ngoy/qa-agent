import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserProfile } from "@yoqa/runner-client";
import { browserConnectionDeps, openBrowserConnection } from "./browser-connection";
import type { InstalledBrowser } from "./chromium-browsers";
import type { EverydayBrowser } from "./chromium-everyday";
import { fakeChromium, profileDirOf, startFakeCdp } from "./fake-cdp";

const VIEWPORT = { width: 1280, height: 800 };

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error: unknown) => error,
	);
}

/** A port nothing listens on. */
function closedPort(): number {
	const server = Bun.serve({ port: 0, fetch: () => new Response("") });
	const port = server.port ?? 0;
	server.stop(true);
	return port;
}

describe("browser connection: the device id picks the way in", () => {
	test("a port with no CDP endpoint fails, saying how to start the browser", async () => {
		const port = closedPort();
		const error = await rejection(
			openBrowserConnection({ deviceId: `chromium-cdp-${port}` }, browserConnectionDeps()),
		);
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain(`No Chromium DevTools endpoint on port ${port}`);
		expect(message).toContain(`--remote-debugging-port=${port}`);
		expect(message).toContain("non-default --user-data-dir");
	});

	test("a port that answers but is not CDP fails the same way", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("hello", { status: 404 }) });
		try {
			const error = await rejection(
				openBrowserConnection({ deviceId: `chromium-cdp-${server.port}` }, browserConnectionDeps()),
			);
			expect((error as Error).message).toContain("--remote-debugging-port");
		} finally {
			server.stop(true);
		}
	});

	test("a web device id that names no browser and no port fails without probing anything", async () => {
		const error = await rejection(
			openBrowserConnection({ deviceId: "web-opera-mini" }, browserConnectionDeps()),
		);
		expect((error as Error).message).toContain("chromium-cdp-<port>");
		expect((error as Error).message).toContain("web-dia, web-arc, web-opera, web-vivaldi)");
	});

	test.each(["web-firefox", "web-safari", "web-firefox-everyday", "web-safari-everyday"])(
		"%s fails saying Firefox and Safari are not supported, without probing anything",
		async (deviceId) => {
			const error = await rejection(openBrowserConnection({ deviceId }, browserConnectionDeps()));
			expect((error as Error).message).toContain("Firefox and Safari are not supported");
			expect((error as Error).message).toContain("chromium-cdp-<port>");
		},
	);
});

describe("browser connection: attached by port", () => {
	test("drives the browser's first page, names it as it reports itself, and clears on restart", async () => {
		const browser = startFakeCdp({ viewport: VIEWPORT });
		const connection = await openBrowserConnection(
			{ deviceId: `chromium-cdp-${browser.port}` },
			browserConnectionDeps(),
		);
		const tab = await connection.firstPage();
		expect(tab).toBe(browser.frontPage() ?? "");
		expect(browser.createdTargets).toEqual([]);
		expect(await connection.label()).toEqual({ browser: "Chrome 140.0.0.0" });
		expect(connection.restartStorage).toBe("cleared");
		await connection.disconnect([tab]);
		browser.kill();
	});

	test("disconnecting closes only the DevTools socket: the browser and its pages stay", async () => {
		const browser = startFakeCdp({ viewport: VIEWPORT });
		const deviceId = `chromium-cdp-${browser.port}`;
		const connection = await openBrowserConnection({ deviceId }, browserConnectionDeps());
		const page = await connection.firstPage();
		const before = browser.pages();
		await connection.disconnect([page]);
		expect(browser.pages()).toEqual(before);
		// Another connection attaches to it.
		const again = await openBrowserConnection({ deviceId }, browserConnectionDeps());
		await again.disconnect([]);
		browser.kill();
	});
});

const CHROME: InstalledBrowser = {
	id: "web-chrome",
	name: "Google Chrome",
	version: "141.0",
	executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
};

const DIA: InstalledBrowser = {
	id: "web-dia",
	name: "Dia",
	version: "1.55.1",
	executable: "/Applications/Dia.app/Contents/MacOS/Dia",
};

/**
 * A Mac with Chrome and Dia installed, and a connection that launches `deviceId`, its Kept
 * profile under a temporary home unless the connect asks for a clean one.
 */
async function launch(
	deviceId = "web-chrome",
	options: {
		profile?: BrowserProfile;
		home?: string;
		ignoresBrowserClose?: boolean;
		browserCloseGraceMs?: number;
	} = {},
) {
	const chromium = fakeChromium(
		{ viewport: VIEWPORT, ignoresBrowserClose: options.ignoresBrowserClose },
		// Dia writes its port file under `User Data/`.
		{ portFileDir: deviceId === "web-dia" ? "User Data" : "" },
	);
	const home = options.home ?? mkdtempSync(join(tmpdir(), "yoqa-home-"));
	const connection = await openBrowserConnection(
		{ deviceId, profile: options.profile },
		browserConnectionDeps({
			installedBrowsers: async () => [CHROME, DIA],
			spawn: chromium.spawn,
			home,
			browserCloseGraceMs: options.browserCloseGraceMs,
		}),
	);
	const profileDir = () => profileDirOf(chromium.launched[0] ?? []) ?? "";
	return { chromium, connection, home, profileDir };
}

describe("browser connection: a browser Yoqa launches", () => {
	test("names the installed browser it launched, with its version, and clears on restart", async () => {
		const { connection } = await launch();
		expect(await connection.label()).toEqual({ browser: "Google Chrome 141.0" });
		expect(connection.restartStorage).toBe("cleared");
		await connection.disconnect([]);
	});

	test("disconnecting closes the browser over CDP and keeps its profile for the next connect", async () => {
		const { chromium, connection, home, profileDir } = await launch();
		writeFileSync(join(profileDir(), "Cookies"), "signed in");
		await connection.disconnect([await connection.firstPage()]);
		// Chrome, Edge and Opera save their cookies only when they shut down on their own.
		expect(chromium.closes).toBe(1);
		expect(chromium.kills).toBe(0);
		expect(existsSync(join(profileDir(), "Cookies"))).toBe(true);

		const again = await launch("web-chrome", { home });
		expect(again.profileDir()).toBe(profileDir());
		expect(existsSync(join(again.profileDir(), "Cookies"))).toBe(true);
		await again.connection.disconnect([]);
	});

	test("Dia is quit by signal: its Browser.close leaves the app running on another profile", async () => {
		const { chromium, connection } = await launch("web-dia");
		await connection.disconnect([]);
		expect(chromium.browsers[0]?.methods).not.toContain("Browser.close");
		expect(chromium.kills).toBe(1);
	});

	test("a browser that stays open after Browser.close is killed once the grace runs out", async () => {
		const { chromium, connection } = await launch("web-chrome", {
			ignoresBrowserClose: true,
			browserCloseGraceMs: 50,
		});
		await connection.disconnect([]);
		expect(chromium.closes).toBe(0);
		expect(chromium.kills).toBe(1);
	});

	test("a connect that asks for a clean profile gets a temporary one, deleted on disconnect", async () => {
		const { connection, home, profileDir } = await launch("web-chrome", { profile: "clean" });
		expect(profileDir()).not.toContain(home);
		expect(existsSync(profileDir())).toBe(true);
		await connection.disconnect([]);
		expect(existsSync(profileDir())).toBe(false);
	});

	test("a failed setup stops the browser by signal, keeping its Kept profile", async () => {
		const { chromium, connection, profileDir } = await launch();
		await connection.abort();
		expect(chromium.kills).toBe(1);
		expect(chromium.browsers[0]?.methods).not.toContain("Browser.close");
		expect(existsSync(profileDir())).toBe(true);
	});

	test("a dead session's browser is stopped by signal, and its exit settles", async () => {
		const { chromium, connection, profileDir } = await launch();
		let exited = false;
		void connection.exited.then(() => {
			exited = true;
		});
		connection.abandon();
		await Bun.sleep(20);
		expect(exited).toBe(true);
		expect(chromium.kills).toBe(1);
		expect(existsSync(profileDir())).toBe(true);
	});

	test("a browser that is not installed fails the connect and launches nothing", async () => {
		const chromium = fakeChromium({ viewport: VIEWPORT });
		const error = await rejection(
			openBrowserConnection(
				{ deviceId: "web-edge" },
				browserConnectionDeps({ installedBrowsers: async () => [CHROME], spawn: chromium.spawn }),
			),
		);
		expect((error as Error).message).toContain("web-edge is not installed");
		expect(chromium.launched).toEqual([]);
	});
});

/** CDP commands that clear a browser's cookies, storage or cache. */
const WIPES =
	/^(Storage\.clear|Network\.clear|Network\.deleteCookies|Storage\.deleteStorageBucket)/;

function everydayChrome(port: number): EverydayBrowser {
	const userDataDir = mkdtempSync(join(tmpdir(), "yoqa-chrome-"));
	writeFileSync(join(userDataDir, "DevToolsActivePort"), `${port}\n/devtools/browser/fake\n`);
	writeFileSync(
		join(userDataDir, "Local State"),
		JSON.stringify({
			profile: { last_used: "Default", info_cache: { Default: { name: "Work" } } },
		}),
	);
	return {
		id: "web-chrome-everyday",
		name: "Google Chrome",
		userDataDir,
		executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	};
}

/** The user's Chrome with remote debugging on and a tab of their own, which the user allows. */
async function everyday() {
	const browser = startFakeCdp({ viewport: VIEWPORT, consent: true });
	const userTab = browser.openPage("https://mail.example.com/inbox");
	browser.allow();
	const connection = await openBrowserConnection(
		{ deviceId: "web-chrome-everyday" },
		browserConnectionDeps({ everydayBrowsers: async () => [everydayChrome(browser.port)] }),
	);
	return { browser, connection, userTab };
}

describe("browser connection: the Everyday browser", () => {
	test("each page it opens is blank, in a new window of Yoqa's own, over one socket", async () => {
		const { browser, connection, userTab } = await everyday();
		const first = await connection.firstPage();
		const blank = await connection.blankPage();
		expect([first, blank]).not.toContain(userTab);
		expect(browser.createdTargets).toEqual([
			{ url: "about:blank", newWindow: true },
			{ url: "about:blank", newWindow: true },
		]);
		expect(browser.methods).not.toContain("Target.getTargets");
		expect(browser.socketRequests()).toBe(1);
		await connection.disconnect([first, blank]);
		browser.kill();
	});

	test("names the browser and the profile its window opens in, and keeps storage on restart", async () => {
		const { browser, connection } = await everyday();
		expect(await connection.label()).toEqual({
			browser: "Google Chrome 140.0.0.0",
			browserProfileName: "Work",
		});
		expect(connection.restartStorage).toBe("kept");
		await connection.disconnect([]);
		browser.kill();
	});

	test("disconnecting closes only the session's pages, and leaves the browser and the user's tabs", async () => {
		const { browser, connection } = await everyday();
		const own = await connection.firstPage();
		await connection.disconnect([own]);
		expect(browser.pages()).toEqual(["about:blank", "https://mail.example.com/inbox"]);
		expect(browser.methods.filter((method) => WIPES.test(method))).toEqual([]);
		expect(browser.methods).not.toContain("Browser.close");
		// The browser is still up: a second connect asks again.
		const status = await fetch(`http://127.0.0.1:${browser.port}/json/version`);
		expect(status.status).toBe(404);
		browser.kill();
	});

	test("a failed setup closes the window it opened, and nothing else", async () => {
		const { browser, connection } = await everyday();
		const before = browser.pages();
		await connection.firstPage();
		await connection.abort();
		expect(browser.pages()).toEqual(before);
		browser.kill();
	});

	test("a Deny fails the connect once, and nothing is opened in the browser", async () => {
		const browser = startFakeCdp({ viewport: VIEWPORT, consent: true });
		browser.deny();
		const error = await rejection(
			openBrowserConnection(
				{ deviceId: "web-chrome-everyday" },
				browserConnectionDeps({ everydayBrowsers: async () => [everydayChrome(browser.port)] }),
			),
		);
		expect((error as Error).message).toBe("Remote debugging was denied in Google Chrome");
		expect(browser.socketRequests()).toBe(1);
		expect(browser.createdTargets).toEqual([]);
		browser.kill();
	});

	test("a browser that is not installed fails the connect", async () => {
		const error = await rejection(
			openBrowserConnection(
				{ deviceId: "web-dia-everyday" },
				browserConnectionDeps({ everydayBrowsers: async () => [] }),
			),
		);
		expect((error as Error).message).toContain("web-dia-everyday is not installed");
	});
});
