import { describe, expect, test } from "bun:test";
import { type FakeCdpOptions, startFakeCdp } from "./fake-cdp";
import { performAction } from "./interaction";
import { isDeadSessionError } from "./lane";
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

	test("an Action this slice does not drive yet fails clearly", async () => {
		const { session } = await attach();
		const error = await rejection(
			performAction(session, { kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 }),
		);
		expect((error as Error).message).toContain("not available on the web Direct lane yet");
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
