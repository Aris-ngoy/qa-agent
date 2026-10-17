import { describe, expect, test } from "bun:test";
import type { CaseScript } from "@yoqa/runner-client";
import { executeScriptCase } from "../runs/case-executor";
import { type FakeAxNode, type FakeCdpOptions, startFakeCdp } from "./fake-cdp";
import { getScreen, performAction } from "./interaction";
import { ActionUnsupportedError, isDeadSessionError } from "./lane";
import { createDeviceSession } from "./session";

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
	test("opens on the Direct lane, with Screenshot Poll as its Frame Feed", async () => {
		const { session } = await attach();
		expect(session.lane).toBe("direct");
		expect(session.stream).toBeNull();
		expect(session.startRecording).toBeUndefined();
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

	test("a web device id that names no port fails without probing anything", async () => {
		const error = await rejection(createDeviceSession({ platform: "web", deviceId: "web-chrome" }));
		expect((error as Error).message).toContain("chromium-cdp-<port>");
	});
});

describe("web Direct lane: Actions reach the page", () => {
	test("the screenshot is the page viewport, not the whole page", async () => {
		const { session } = await attach({ pageHeight: 4000 });
		const frame = await session.captureFrame();
		expect(pngSize(frame.base64)).toEqual({
			width: VIEWPORT.width * 2,
			height: VIEWPORT.height * 2,
		});
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

	test("open-url fails when the page cannot load the URL", async () => {
		const { session } = await attach({ navigateError: "net::ERR_NAME_NOT_RESOLVED" });
		const error = await rejection(
			performAction(session, { kind: "open-url", url: "https://nowhere.invalid" }),
		);
		expect((error as Error).message).toContain("net::ERR_NAME_NOT_RESOLVED");
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
