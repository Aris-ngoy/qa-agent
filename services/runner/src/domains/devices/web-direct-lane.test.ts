import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { type CaseScript, VIEWPORT_PRESETS } from "@yoqa/runner-client";
import { executeScriptCase } from "../runs/case-executor";
import type { InstalledBrowser } from "./chromium-browsers";
import {
	type FakeAxNode,
	type FakeCdpOptions,
	fakeChromium,
	jpegSize,
	profileDirOf,
	readMjpegFrames,
	startFakeCdp,
} from "./fake-cdp";
import { getScreen, performAction } from "./interaction";
import { ActionUnsupportedError, type DeviceSession, isDeadSessionError } from "./lane";
import { trackMjpegProxy } from "./mjpeg-proxy";
import { createDeviceSession } from "./session";
import { createWebDirectSession, showsPreset, webDirectDeps } from "./web-direct-lane";

/** The desktop Viewport preset's page, which every session here is on. */
const VIEWPORT = { width: 1280, height: 800 };

/** A Chromium the user started with a debug port, and a Device Session attached to it. */
async function attach(options: Partial<FakeCdpOptions> = {}) {
	const browser = startFakeCdp({ viewport: VIEWPORT, deviceScaleFactor: 2, ...options });
	let deadCalls = 0;
	const session = await createDeviceSession({
		platform: "web",
		deviceId: `chromium-cdp-${browser.port}`,
		onSessionDead: () => {
			deadCalls += 1;
		},
	});
	return { browser, session, deadCalls: () => deadCalls };
}

/** A port nothing listens on. */
function closedPort(): number {
	const server = Bun.serve({ port: 0, fetch: () => new Response("") });
	const port = server.port ?? 0;
	server.stop(true);
	return port;
}

function pngSize(base64: string): { width: number; height: number } {
	const png = Buffer.from(base64, "base64");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error: unknown) => error,
	);
}

describe("web Direct lane: attach by port", () => {
	test("opens on the Direct lane, with a Stream as its Frame Feed", async () => {
		const { session } = await attach();
		expect(session.lane).toBe("direct");
		expect(session.stream).toMatchObject({ ready: true });
		expect(session.startRecording).toBeUndefined();
		await session.quit();
	});

	test("names the browser it attached to, as the browser reports itself", async () => {
		const { session } = await attach();
		expect(session.browser).toBe("Chrome 140.0.0.0");
		await session.quit();
	});

	test("a port with no CDP endpoint fails, saying how to start the browser", async () => {
		const port = closedPort();
		const error = await rejection(
			createDeviceSession({ platform: "web", deviceId: `chromium-cdp-${port}` }),
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
				createDeviceSession({ platform: "web", deviceId: `chromium-cdp-${server.port}` }),
			);
			expect((error as Error).message).toContain("--remote-debugging-port");
		} finally {
			server.stop(true);
		}
	});

	test("a web device id that names no browser and no port fails without probing anything", async () => {
		const error = await rejection(
			createDeviceSession({ platform: "web", deviceId: "web-firefox" }),
		);
		expect((error as Error).message).toContain("chromium-cdp-<port>");
	});
});

describe("web Direct lane: Actions reach the page", () => {
	test("the screenshot is the page viewport, not the whole page", async () => {
		const { session } = await attach({ pageHeight: 4000 });
		const frame = await session.captureFrame();
		// The desktop preset is at one screenshot pixel per CSS pixel, on a 2× display too.
		expect(pngSize(frame.base64)).toEqual(VIEWPORT);
		await session.quit();
	});

	test("a tap lands on the viewport point, in the page's CSS pixels", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "tap", x: 500, y: 250 });
		expect(browser.clicks).toEqual([{ x: 640, y: 200 }]);
		await session.quit();
	});

	test("input clicks the field, then types into it; a newline presses Enter", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "input", x: 100, y: 100, text: "hello\nworld" });
		expect(browser.clicks).toEqual([{ x: 128, y: 80 }]);
		expect(browser.insertedText).toEqual(["hello", "world"]);
		expect(browser.keys).toEqual(["Enter"]);
		await session.quit();
	});

	test("open-url navigates the page", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "open-url", url: "https://example.com/login" });
		expect(browser.navigations).toEqual(["https://example.com/login"]);
		await session.quit();
	});

	test("open-url waits for the page to load, so the next screenshot captures it", async () => {
		const { session } = await attach();
		await session.openUrl("https://example.com/");
		expect((await session.screenshot()).base64).not.toBe("");
		await session.quit();
	});

	test("open-url fails when the page cannot load the URL", async () => {
		const { session } = await attach({ navigateError: "net::ERR_NAME_NOT_RESOLVED" });
		const error = await rejection(
			performAction(session, { kind: "open-url", url: "https://nowhere.invalid" }),
		);
		expect((error as Error).message).toContain("net::ERR_NAME_NOT_RESOLVED");
		await session.quit();
	});
});

/**
 * Watch the session's Stream, as the runner's `/stream.mjpeg` proxy does. Hanging up
 * aborts the request: a fetch whose body is only cancelled keeps its socket open.
 */
async function watch(session: DeviceSession) {
	const upstream = session.stream?.upstreamUrl;
	if (!upstream) throw new Error("The session has no Stream");
	const watcher = new AbortController();
	const response = await fetch(upstream, { signal: watcher.signal });
	return { response, hangUp: () => watcher.abort() };
}

/** Wait up to a second for `check` to hold. */
async function eventually(check: () => boolean): Promise<boolean> {
	for (let tries = 0; tries < 50 && !check(); tries++) await Bun.sleep(20);
	return check();
}

describe("web Direct lane: screencast Frame Feed", () => {
	test("nothing screencasts until someone watches the Stream", async () => {
		const { browser, session } = await attach();
		await Bun.sleep(50);
		expect(browser.screencastStarts).toEqual([]);
		await session.quit();
	});

	test("the Stream is the page's screencast as JPEG frames, at the preset's size", async () => {
		const { browser, session } = await attach();
		const { response } = await watch(session);
		expect(response.headers.get("Content-Type")).toContain("multipart/x-mixed-replace");
		const frames = await readMjpegFrames(response, 3);
		for (const frame of frames) expect(jpegSize(frame)).toEqual(VIEWPORT);
		expect(browser.screencastStarts).toEqual([
			expect.objectContaining({ format: "jpeg", maxWidth: 1280, maxHeight: 800 }),
		]);
		await session.quit();
	});

	test("every frame is acked, so the browser keeps sending them", async () => {
		const { browser, session } = await attach();
		await readMjpegFrames((await watch(session)).response, 4);
		expect(browser.screencastFrames.length).toBeGreaterThanOrEqual(4);
		await session.quit();
	});

	test("a frame of the whole window, not the preset, is not served", async () => {
		const { browser, session } = await attach();
		await readMjpegFrames((await watch(session)).response, 3);
		// Chromium paints the window's view until the emulation is set again.
		const served = browser.screencastFrames.filter(
			(frame) => frame.deviceWidth === VIEWPORT.width && frame.deviceHeight === VIEWPORT.height,
		);
		expect(served.length).toBeGreaterThanOrEqual(3);
		expect(browser.emulation().viewport).toEqual(VIEWPORT);
		await session.quit();
	});

	test("the screencast stops when the last watcher leaves", async () => {
		const { browser, session } = await attach();
		const first = await watch(session);
		const second = await watch(session);
		await readMjpegFrames(first.response, 1);
		first.hangUp();
		await Bun.sleep(30);
		expect(browser.screencasting()).toBe(true);
		second.hangUp();
		expect(await eventually(() => !browser.screencasting())).toBe(true);
		// Someone watching again starts it again.
		await watch(session);
		expect(await eventually(() => browser.screencastStarts.length === 2)).toBe(true);
		await session.quit();
	});

	test("disconnecting stops the screencast and ends the Stream", async () => {
		const { browser, session } = await attach();
		const { response } = await watch(session);
		const reader = response.body?.getReader();
		await reader?.read();
		expect(browser.screencasting()).toBe(true);
		await session.quit();
		expect(await eventually(() => !browser.screencasting())).toBe(true);
		let done = false;
		while (!done) done = (await reader?.read())?.done ?? true;
		expect(done).toBe(true);
	});

	test("a popup the page opens is what the Stream shows, at the session's preset", async () => {
		const { browser, session } = await attach();
		await readMjpegFrames((await watch(session)).response, 1);
		const popup = browser.openPage("https://accounts.example.com/signin", {
			fromFrontPage: true,
			viewport: { width: 500, height: 600 },
		});
		expect(await eventually(() => browser.screencasting(popup))).toBe(true);
		const frames = await readMjpegFrames((await watch(session)).response, 2);
		for (const frame of frames) expect(jpegSize(frame)).toEqual(VIEWPORT);
		expect(browser.screencasting("page-1")).toBe(false);
		await session.quit();
	});

	test("reading the Screen does not pause the Stream, as it does a phone's", async () => {
		const { session } = await attach();
		const proxy = trackMjpegProxy();
		await getScreen(session);
		expect(proxy.signal.aborted).toBe(false);
		proxy.abort();
		await session.quit();
	});

	test("a frame shows the preset only at its size, with nothing above the page", () => {
		const mobile = VIEWPORT_PRESETS.mobile;
		const frame = { deviceWidth: 390, deviceHeight: 844, offsetTop: 0, pageScaleFactor: 1 };
		expect(showsPreset(frame, mobile)).toBe(true);
		expect(showsPreset({ ...frame, deviceWidth: 1200, deviceHeight: 687 }, mobile)).toBe(false);
		expect(showsPreset({ ...frame, offsetTop: 56 }, mobile)).toBe(false);
	});

	test("Run screenshots are still single captures, not screencast frames", async () => {
		const { session } = await attach();
		const frame = await session.captureFrame();
		expect(frame.mime).toBe("image/png");
		await session.quit();
	});
});

const APP_URL = "https://app.example.com/home";

describe("web Direct lane: app lifecycle", () => {
	test("terminate-app closes the App's page and leaves the session on a blank one", async () => {
		const { browser, session, deadCalls } = await attach();
		await performAction(session, { kind: "open-url", url: APP_URL });
		await performAction(session, { kind: "terminate-app", appId: APP_URL });
		expect(browser.pages()).toEqual(["about:blank"]);
		expect(deadCalls()).toBe(0);
		// The session drives the page that is left.
		await performAction(session, { kind: "tap", x: 500, y: 500 });
		expect(browser.clicks).toEqual([{ x: 640, y: 400 }]);
		await session.quit();
	});

	test("activate-app reopens the App's page after terminate-app", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "open-url", url: APP_URL });
		await performAction(session, { kind: "terminate-app", appId: APP_URL });
		await performAction(session, { kind: "activate-app", appId: APP_URL });
		expect(browser.pages()).toEqual([APP_URL]);
		await session.quit();
	});

	test("activate-app leaves a page already on the App where it is", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "open-url", url: "https://app.example.com/cart" });
		await performAction(session, { kind: "activate-app", appId: APP_URL });
		expect(browser.navigations).toEqual(["https://app.example.com/cart"]);
		await session.quit();
	});

	test("restart-app clears the App origin's storage, then loads the App again", async () => {
		const { browser, session } = await attach();
		await performAction(session, { kind: "open-url", url: "https://app.example.com/cart" });
		await performAction(session, { kind: "restart-app", appId: APP_URL });
		expect(browser.clearedOrigins).toEqual(["https://app.example.com"]);
		expect(browser.navigations).toEqual(["https://app.example.com/cart", APP_URL]);
		expect(browser.pages()).toEqual([APP_URL]);
		await session.quit();
	});

	test("an app id that is not a web URL fails clearly", async () => {
		const { session } = await attach();
		const error = await rejection(
			performAction(session, { kind: "activate-app", appId: "com.example.app" }),
		);
		expect((error as Error).message).toContain("Web URL");
		await session.quit();
	});

	test("background-app fails as not supported on web", async () => {
		const { session } = await attach();
		const error = await rejection(performAction(session, { kind: "background-app", seconds: 3 }));
		expect(error).toBeInstanceOf(ActionUnsupportedError);
		expect((error as Error).message).toContain("not supported on web");
		await session.quit();
	});
});

/** A sign-in form, in the viewport's CSS pixels. */
const SIGN_IN: FakeAxNode[] = [
	{ role: "heading", name: "Welcome back", box: { x: 64, y: 40, width: 640, height: 48 } },
	{
		role: "textbox",
		name: "Email",
		domId: "email",
		box: { x: 64, y: 120, width: 640, height: 40 },
	},
	{
		role: "button",
		name: "Sign in",
		testId: "sign-in-button",
		box: { x: 64, y: 240, width: 128, height: 40 },
	},
	{
		role: "button",
		name: "Cookie settings",
		hidden: true,
		box: { x: 0, y: 0, width: 0, height: 0 },
	},
];

describe("web Direct lane: Screen", () => {
	test("the Screen is the page's cleaned accessibility tree on 0–1000 of the viewport", async () => {
		const { session } = await attach({ nodes: SIGN_IN });
		const screen = await getScreen(session, { pauseMjpeg: false });
		expect(screen.full).toBe(false);
		expect(screen.window).toEqual(VIEWPORT);
		expect(screen.elements).toEqual([
			{
				type: "heading",
				label: "Welcome back",
				x: 50,
				y: 50,
				width: 500,
				height: 60,
				enabled: true,
			},
			{
				type: "textbox",
				label: "Email",
				id: "email",
				x: 50,
				y: 150,
				width: 500,
				height: 50,
				enabled: true,
			},
			{
				type: "button",
				label: "Sign in",
				id: "sign-in-button",
				x: 50,
				y: 300,
				width: 100,
				height: 50,
				enabled: true,
			},
		]);
		await session.quit();
	});

	test("on a scrolled page, boxes are where the elements are in the viewport", async () => {
		const { session } = await attach({ nodes: SIGN_IN, scroll: { x: 0, y: 1200 } });
		const screen = await getScreen(session, { pauseMjpeg: false });
		expect(screen.elements?.find((el) => el.label === "Sign in")).toMatchObject({ x: 50, y: 300 });
		await session.quit();
	});

	test("a tab that has not painted still gets boxes in CSS pixels", async () => {
		const { session } = await attach({
			nodes: SIGN_IN,
			unpainted: true,
			scroll: { x: 0, y: 1200 },
		});
		const screen = await getScreen(session, { pauseMjpeg: false });
		expect(screen.elements?.find((el) => el.label === "Sign in")).toMatchObject({
			x: 50,
			y: 300,
			width: 100,
			height: 50,
		});
		await session.quit();
	});

	test("--full is the raw accessibility tree, hidden nodes and all, with boxes", async () => {
		const { session } = await attach({ nodes: SIGN_IN });
		const screen = await getScreen(session, { full: true, pauseMjpeg: false });
		expect(screen.full).toBe(true);
		const raw = JSON.parse(screen.raw ?? "") as { axTree: Array<Record<string, unknown>> };
		const roles = raw.axTree.map((node) => (node.role as { value: string }).value);
		expect(roles).toEqual(["RootWebArea", "heading", "textbox", "button", "button"]);
		expect(raw.axTree.find((node) => node.testId === "sign-in-button")).toMatchObject({
			name: { value: "Sign in" },
			bounds: { x: 64, y: 240, width: 128, height: 40 },
		});
		expect(raw.axTree.at(-1)).toMatchObject({ ignored: true });
		await session.quit();
	});

	test("a tap by label or id clicks the middle of that control", async () => {
		const { browser, session } = await attach({ nodes: SIGN_IN });
		await performAction(session, { kind: "tap", label: "Sign in" });
		await performAction(session, { kind: "tap", id: "email" });
		expect(browser.clicks).toEqual([
			{ x: 128, y: 260 },
			{ x: 384, y: 140 },
		]);
		await session.quit();
	});

	test("a Case Script tap by label replays on the page", async () => {
		const { browser, session } = await attach({ nodes: SIGN_IN });
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", label: "Sign in" }],
		};
		const status = await executeScriptCase({
			script,
			session,
			isAborted: () => false,
			appendStep: async () => undefined,
			settleMs: 0,
		});
		expect(status).toBe("passed");
		expect(browser.clicks).toEqual([{ x: 128, y: 260 }]);
		await session.quit();
	});
});

describe("web Direct lane: Dead Session", () => {
	test("closing the page the session drives ends the session", async () => {
		const { browser, session, deadCalls } = await attach();
		browser.closePage();
		await Bun.sleep(50);
		const error = await rejection(session.captureFrame());
		expect(isDeadSessionError(error)).toBe(true);
		expect((error as Error).message).toContain("the page was closed");
		expect(deadCalls()).toBe(1);
		await session.quit();
	});

	test("disconnecting closes only the DevTools socket and is not a Dead Session", async () => {
		const { browser, session, deadCalls } = await attach();
		await session.quit();
		expect(deadCalls()).toBe(0);
		// The browser is still there: another session attaches to it.
		const again = await createDeviceSession({
			platform: "web",
			deviceId: `chromium-cdp-${browser.port}`,
		});
		await again.quit();
	});
});

const CHROME: InstalledBrowser = {
	id: "web-chrome",
	name: "Google Chrome",
	version: "141.0",
	executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
};

/** A Mac with Chrome installed, and a Device Session on `deviceId` that launches it. */
async function launch(deviceId = "web-chrome") {
	const chromium = fakeChromium({ viewport: VIEWPORT });
	let deadCalls = 0;
	const session = await createWebDirectSession(
		{
			platform: "web",
			deviceId,
			onSessionDead: () => {
				deadCalls += 1;
			},
		},
		webDirectDeps({ installedBrowsers: async () => [CHROME], spawn: chromium.spawn }),
	);
	const profileDir = () => profileDirOf(chromium.launched[0] ?? []) ?? "";
	return { chromium, session, profileDir, deadCalls: () => deadCalls };
}

describe("web Direct lane: a Yoqa-owned instance of an installed browser", () => {
	test("connecting launches the browser on its own temporary profile and drives its page", async () => {
		const { chromium, session, profileDir } = await launch();
		expect(chromium.launched).toHaveLength(1);
		expect(chromium.launched[0]?.[0]).toBe(CHROME.executable);
		expect(existsSync(profileDir())).toBe(true);
		await performAction(session, { kind: "tap", x: 500, y: 250 });
		expect(chromium.browsers[0]?.clicks).toEqual([{ x: 640, y: 200 }]);
		await session.quit();
	});

	test("names the installed browser it launched, with its version", async () => {
		const { session } = await launch();
		expect(session.browser).toBe("Google Chrome 141.0");
		await session.quit();
	});

	test("disconnecting kills the browser and deletes its profile, and is not a Dead Session", async () => {
		const { chromium, session, profileDir, deadCalls } = await launch();
		await session.quit();
		expect(chromium.kills).toBe(1);
		expect(existsSync(profileDir())).toBe(false);
		expect(deadCalls()).toBe(0);
	});

	test("a browser that is not installed fails the connect and launches nothing", async () => {
		const chromium = fakeChromium({ viewport: VIEWPORT });
		const error = await rejection(
			createWebDirectSession(
				{ platform: "web", deviceId: "web-edge" },
				webDirectDeps({ installedBrowsers: async () => [CHROME], spawn: chromium.spawn }),
			),
		);
		expect((error as Error).message).toContain("web-edge is not installed");
		expect(chromium.launched).toEqual([]);
	});

	test("the browser quitting on its own is a Dead Session, and its profile is deleted", async () => {
		const { chromium, session, profileDir, deadCalls } = await launch();
		chromium.browsers[0]?.kill();
		await Bun.sleep(50);
		const error = await rejection(session.captureFrame());
		expect(isDeadSessionError(error)).toBe(true);
		expect(deadCalls()).toBe(1);
		expect(existsSync(profileDir())).toBe(false);
	});

	test("closing its page ends the session and quits the browser it launched", async () => {
		const { chromium, session, profileDir, deadCalls } = await launch();
		chromium.browsers[0]?.closePage();
		await Bun.sleep(50);
		expect(isDeadSessionError(await rejection(session.captureFrame()))).toBe(true);
		expect(deadCalls()).toBe(1);
		expect(chromium.kills).toBe(1);
		expect(existsSync(profileDir())).toBe(false);
	});
});
