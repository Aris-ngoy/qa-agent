import { describe, expect, test } from "bun:test";
import { readdir, unlink } from "node:fs/promises";
import { KEY_MODIFIERS, KEY_NAMES, VIEWPORT_PRESETS } from "@yoqa/runner-client";
import { pngSizeFromBase64 } from "./android-gestures";
import { jpegSize, readMjpegFrames } from "./fake-cdp";
import { getScreen, performAction } from "./interaction";
import { UnsupportedKeyError, isDeadSessionError } from "./lane";
import {
	BUTTON,
	DEVICE,
	type LaneHarness,
	androidAdbLane,
	androidDevtoolsLane,
	androidLatestFrameLane,
	iosDeviceLane,
	iosIdbLane,
	iosYoqaAxLane,
	iosYoqaSimLane,
	webCdpLane,
	webLaunchedLane,
	webMobileLane,
} from "./lane-harnesses";
import { SCREENSHOT_DIR } from "./screenshot-retention";

/**
 * What every Lane must do for Actions to work (see `Lane` in CONTEXT.md). A new Lane
 * joins by adding its harness to this list.
 */
const LANES: Array<() => LaneHarness> = [
	androidAdbLane,
	androidLatestFrameLane,
	androidDevtoolsLane,
	iosIdbLane,
	iosYoqaSimLane,
	iosYoqaAxLane,
	iosDeviceLane,
	webCdpLane,
	webLaunchedLane,
	webMobileLane,
];

async function screenshotFiles(): Promise<string[]> {
	return readdir(SCREENSHOT_DIR).catch(() => []);
}

async function open(harness: LaneHarness) {
	let deadCalls = 0;
	const session = await harness.open({
		onSessionDead: () => {
			deadCalls += 1;
		},
	});
	return { session, deadCalls: () => deadCalls };
}

for (const makeHarness of LANES) {
	const { name } = makeHarness();

	describe(`Lane contract: ${name}`, () => {
		test("a tap at the 0–1000 corners lands on the matching device edges", async () => {
			const harness = makeHarness();
			const { session } = await open(harness);
			await session.tap(0, 0);
			await session.tap(1000, 1000);
			await session.tap(1000, 0);
			expect(harness.taps()).toEqual([
				{ x: 0, y: 0 },
				{ x: DEVICE.width, y: DEVICE.height },
				{ x: DEVICE.width, y: 0 },
			]);
		});

		test("a tap in screenshot space lands on the same device edges", async () => {
			const harness = makeHarness();
			const { session } = await open(harness);
			await session.captureFrame();
			await session.tap(0, 0, { coordSpace: "screenshot" });
			await session.tap(1000, 1000, { coordSpace: "screenshot" });
			await session.tap(1000, 0, { coordSpace: "screenshot" });
			expect(harness.taps()).toEqual([
				{ x: 0, y: 0 },
				{ x: DEVICE.width, y: DEVICE.height },
				{ x: DEVICE.width, y: 0 },
			]);
		});

		test("capture-frame returns an image and writes nothing to disk", async () => {
			const { session } = await open(makeHarness());
			const before = await screenshotFiles();
			const frame = await session.captureFrame();
			expect(frame.mime).toMatch(/^image\//);
			expect(Buffer.from(frame.base64, "base64").byteLength).toBeGreaterThan(0);
			expect(await screenshotFiles()).toEqual(before);
		});

		test("capture-frame after a tap shows the screen after that tap", async () => {
			const harness = makeHarness();
			const { session } = await open(harness);
			expect((await session.captureFrame()).base64).toBe(harness.frame(0));
			await session.tap(500, 500);
			expect((await session.captureFrame()).base64).toBe(harness.frame(1));
			await session.quit();
		});

		test("screenshot persists one image under the run screenshots directory", async () => {
			const { session } = await open(makeHarness());
			const before = await screenshotFiles();
			const shot = await session.screenshot();
			try {
				expect(shot.path.startsWith(SCREENSHOT_DIR)).toBe(true);
				const added = (await screenshotFiles()).filter((file) => !before.includes(file));
				expect(added).toHaveLength(1);
				expect(shot.base64.length).toBeGreaterThan(0);
			} finally {
				await unlink(shot.path).catch(() => undefined);
			}
		});

		test("a tree read returns the cleaned 0–1000 Screen", async () => {
			const { session } = await open(makeHarness());
			const screen = await getScreen(session, { pauseMjpeg: false });
			if (screen.full) throw new Error("expected the cleaned Screen");
			expect(screen.elements).toEqual([expect.objectContaining(BUTTON)]);
		});

		test("every key the Lane declares reaches the device, with modifiers where it holds them", async () => {
			const harness = makeHarness();
			const { session } = await open(harness);
			const { keys, modifiers } = session.keySupport;
			expect(keys.length).toBeGreaterThan(0);
			const held = modifiers ? [...KEY_MODIFIERS] : [];
			for (const key of keys) await session.key(key, held);
			expect(harness.keys()).toEqual(keys.map((key) => ({ key, modifiers: held })));
		});

		test("a key the Lane does not declare fails clearly and reaches nothing", async () => {
			const harness = makeHarness();
			const { session } = await open(harness);
			const { keys, modifiers } = session.keySupport;
			for (const key of KEY_NAMES.filter((name) => !keys.includes(name))) {
				const error = await session.key(key).catch((caught: unknown) => caught);
				expect(error).toBeInstanceOf(UnsupportedKeyError);
				expect((error as Error).message).toContain(key);
			}
			if (!modifiers) {
				const [first] = keys;
				if (!first) throw new Error("the Lane declares no keys");
				const error = await session.key(first, ["Shift"]).catch((caught: unknown) => caught);
				expect(error).toBeInstanceOf(UnsupportedKeyError);
				expect((error as Error).message).toContain("Shift");
			}
			expect(harness.keys()).toEqual([]);
		});

		test("quit is idempotent", async () => {
			const { session } = await open(makeHarness());
			await session.quit();
			await session.quit();
		});

		test("a dead device tool surfaces as a Dead Session", async () => {
			const harness = makeHarness();
			const { session, deadCalls } = await open(harness);
			harness.killTool();
			const error = await session.captureFrame().then(
				() => null,
				(caught: unknown) => caught,
			);
			expect(isDeadSessionError(error)).toBe(true);
			expect(deadCalls()).toBe(1);
			await session.quit();
		});
	});
}

const DESKTOP = VIEWPORT_PRESETS.desktop;
const MOBILE = VIEWPORT_PRESETS.mobile;

/** A sign-in popup's viewport, smaller than the page that opens it. */
const POPUP = { width: 500, height: 600 };

/**
 * What the web Direct lane must do for shared cases to keep their meaning in a browser:
 * the gestures a phone has become their mouse and wheel equivalents, and a JavaScript
 * dialog is the alert. A popup the page opens is followed, and left again when it closes.
 * In CSS pixels of the desktop preset's viewport.
 */
describe("Lane contract: web Direct (web-only Actions)", () => {
	test("swipe up scrolls the content under its start point down, by the swipe's length", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		await performAction(session, { kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 });
		expect(harness.browser.wheels).toEqual([
			{ x: DESKTOP.width / 2, y: DESKTOP.height * 0.8, deltaX: 0, deltaY: DESKTOP.height * 0.6 },
		]);
		await session.quit();
	});

	test("swipe right scrolls the content left", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		await performAction(session, { kind: "swipe", x: 200, y: 500, x2: 700, y2: 500 });
		expect(harness.browser.wheels).toEqual([
			{ x: DESKTOP.width * 0.2, y: DESKTOP.height / 2, deltaX: -DESKTOP.width / 2, deltaY: 0 },
		]);
		await session.quit();
	});

	test("drag presses at the start, moves with the button held, and releases at the end", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		await performAction(session, {
			kind: "drag",
			x: 100,
			y: 500,
			x2: 900,
			y2: 500,
			durationMs: 20,
		});
		const start = { x: DESKTOP.width * 0.1, y: DESKTOP.height / 2 };
		const end = { x: DESKTOP.width * 0.9, y: DESKTOP.height / 2 };
		const events = harness.browser.mouse;
		const pressed = events.findIndex((event) => event.type === "mousePressed");
		expect(events[pressed]).toMatchObject({ ...start, buttons: 1 });
		const held = events.slice(pressed + 1, -1);
		expect(held.length).toBeGreaterThan(1);
		expect(held.every((event) => event.type === "mouseMoved" && event.buttons === 1)).toBe(true);
		expect(held.at(-1)).toMatchObject(end);
		expect(events.at(-1)).toMatchObject({ type: "mouseReleased", ...end, buttons: 0 });
		await session.quit();
	});

	test("alert accept answers a pending JavaScript dialog with OK", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		harness.browser.openDialog("confirm", "Delete this item?");
		await performAction(session, { kind: "alert", alertAction: "accept" });
		expect(harness.browser.dialogAnswers).toEqual([{ accept: true }]);
		await session.quit();
	});

	test("alert dismiss answers a pending JavaScript dialog with Cancel", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		harness.browser.openDialog("beforeunload");
		await performAction(session, { kind: "alert", alertAction: "dismiss" });
		expect(harness.browser.dialogAnswers).toEqual([{ accept: false }]);
		await session.quit();
	});

	test("alert fails clearly when no dialog is open", async () => {
		const { session } = await open(webCdpLane());
		const error = await performAction(session, { kind: "alert", alertAction: "accept" }).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect((error as Error).message).toContain("No JavaScript dialog is open");
		await session.quit();
	});

	test("a popup the page opens becomes the page the session drives, at the session's preset", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		const popup = harness.browser.openPage("https://accounts.example.com/signin", {
			fromFrontPage: true,
			viewport: POPUP,
		});
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		await session.tap(500, 500, { coordSpace: "screenshot" });
		expect(harness.browser.clicksOn(popup)).toEqual([
			{ x: DESKTOP.width, y: DESKTOP.height },
			{ x: DESKTOP.width / 2, y: DESKTOP.height / 2 },
		]);
		expect(harness.browser.clicksOn("page-1")).toEqual([]);
		expect(pngSizeFromBase64((await session.captureFrame()).base64)).toEqual({
			width: DESKTOP.width,
			height: DESKTOP.height,
		});
		expect(await session.getWindowSize()).toEqual({ width: DESKTOP.width, height: DESKTOP.height });
		expect(harness.browser.frontPage()).toBe(popup);
		await session.quit();
	});

	test("closing the popup returns the session to the page that opened it", async () => {
		const harness = webCdpLane();
		const { session, deadCalls } = await open(harness);
		const popup = harness.browser.openPage("https://accounts.example.com/signin", {
			fromFrontPage: true,
			viewport: POPUP,
		});
		await Bun.sleep(50);
		await session.tap(500, 500);
		harness.browser.closePage(popup);
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DESKTOP.width, y: DESKTOP.height }]);
		expect(pngSizeFromBase64((await session.captureFrame()).base64)).toEqual({
			width: DESKTOP.width,
			height: DESKTOP.height,
		});
		expect(harness.browser.frontPage()).toBe("page-1");
		expect(deadCalls()).toBe(0);
		await session.quit();
	});

	test("a popup of a popup returns, as each closes, to the page that opened it", async () => {
		const harness = webCdpLane();
		const { session, deadCalls } = await open(harness);
		const popup = harness.browser.openPage("https://accounts.example.com/signin", {
			fromFrontPage: true,
			viewport: POPUP,
		});
		await Bun.sleep(50);
		const nested = harness.browser.openPage("https://accounts.example.com/consent", {
			fromFrontPage: true,
		});
		await Bun.sleep(50);
		harness.browser.closePage(nested);
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn(popup)).toEqual([{ x: DESKTOP.width, y: DESKTOP.height }]);
		harness.browser.closePage(popup);
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DESKTOP.width, y: DESKTOP.height }]);
		expect(deadCalls()).toBe(0);
		await session.quit();
	});

	test("a new tab the page did not open does not take the session over", async () => {
		const harness = webCdpLane();
		const { session, deadCalls } = await open(harness);
		const tab = harness.browser.openPage("https://example.com/", { viewport: POPUP });
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DESKTOP.width, y: DESKTOP.height }]);
		expect(harness.browser.clicksOn(tab)).toEqual([]);
		harness.browser.closePage(tab);
		await Bun.sleep(50);
		await session.tap(0, 0);
		expect(harness.browser.clicksOn("page-1")).toHaveLength(2);
		expect(deadCalls()).toBe(0);
		await session.quit();
	});
});

/**
 * The Viewport preset a web session is opened with fixes its page size, whatever the
 * browser window's size, so 0–1000 means the same point on every run. Under a mobile
 * preset the page is a phone's: a tap is a touch tap and a swipe a real touch swipe.
 */
describe("Lane contract: web Direct (Viewport presets)", () => {
	for (const preset of [DESKTOP, MOBILE]) {
		test(`the ${preset.name} preset fixes the 0–1000 mapping and the screenshot size`, async () => {
			const harness = webCdpLane({ viewport: preset.name });
			const { session } = await open(harness);
			await session.tap(1000, 1000);
			await session.tap(500, 500, { coordSpace: "screenshot" });
			expect(harness.browser.clicks).toEqual([
				{ x: preset.width, y: preset.height },
				{ x: preset.width / 2, y: preset.height / 2 },
			]);
			expect(await session.getWindowSize()).toEqual({
				width: preset.width,
				height: preset.height,
			});
			expect(pngSizeFromBase64((await session.captureFrame()).base64)).toEqual({
				width: preset.width * preset.deviceScaleFactor,
				height: preset.height * preset.deviceScaleFactor,
			});
			expect(session.viewport).toBe(preset.name);
			await session.quit();
		});

		// The screencast paints in the display's pixels (2 on a Retina Mac) and at first the
		// whole window's view; the Stream is the preset's viewport at its CSS size.
		test(`on a 2x display, the ${preset.name} preset's Stream frames are the preset's size`, async () => {
			const harness = webCdpLane({ viewport: preset.name });
			const { session } = await open(harness);
			const upstream = session.stream?.upstreamUrl ?? "";
			const frames = await readMjpegFrames(await fetch(upstream), 3);
			for (const frame of frames) {
				expect(jpegSize(frame)).toEqual({ width: preset.width, height: preset.height });
			}
			await session.quit();
		});

		// Chromium lays out DOM snapshots in the display's device pixels (2 on a Retina Mac),
		// whatever the preset emulates; the Screen and taps by label are in CSS pixels.
		test(`on a 2x display, the ${preset.name} preset's Screen is in CSS pixels and a tap by label lands on it`, async () => {
			const harness = webCdpLane({ viewport: preset.name });
			const { session } = await open(harness);
			const screen = await getScreen(session, { pauseMjpeg: false });
			expect(screen.elements).toEqual([expect.objectContaining(BUTTON)]);
			await performAction(session, { kind: "tap", label: BUTTON.label });
			const [click] = harness.browser.clicks;
			expect(click?.x).toBeCloseTo(((BUTTON.x + BUTTON.width / 2) / 1000) * preset.width, 0);
			expect(click?.y).toBeCloseTo(((BUTTON.y + BUTTON.height / 2) / 1000) * preset.height, 0);
			await session.quit();
		});
	}

	test("a connect with no preset is desktop", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		expect(session.viewport).toBe("desktop");
		expect(harness.browser.emulation()).toMatchObject({ touch: false, userAgent: undefined });
		await session.quit();
	});

	test("the mobile preset is a phone: a mobile user agent and touch", async () => {
		const harness = webCdpLane({ viewport: "mobile" });
		const { session } = await open(harness);
		expect(harness.browser.emulation()).toMatchObject({ mobile: true, touch: true });
		expect(harness.browser.emulation().userAgent).toContain("Mobile");
		await session.quit();
	});

	test("under the mobile preset a tap is a touch tap, not a mouse click", async () => {
		const harness = webCdpLane({ viewport: "mobile" });
		const { session } = await open(harness);
		await performAction(session, { kind: "tap", x: 500, y: 250 });
		const point = { x: MOBILE.width / 2, y: MOBILE.height / 4 };
		expect(harness.browser.touches).toEqual([
			{ type: "touchStart", points: [point] },
			{ type: "touchEnd", points: [] },
		]);
		expect(harness.browser.mouse).toEqual([]);
		await session.quit();
	});

	test("under the mobile preset a swipe is a touch swipe from start to end, not a wheel", async () => {
		const harness = webCdpLane({ viewport: "mobile" });
		const { session } = await open(harness);
		await performAction(session, {
			kind: "swipe",
			x: 500,
			y: 800,
			x2: 500,
			y2: 200,
			durationMs: 50,
		});
		const start = { x: MOBILE.width / 2, y: MOBILE.height * 0.8 };
		const end = { x: MOBILE.width / 2, y: MOBILE.height * 0.2 };
		const touches = harness.browser.touches;
		expect(touches[0]).toEqual({ type: "touchStart", points: [start] });
		const moves = touches.slice(1, -1);
		expect(moves.length).toBeGreaterThan(1);
		expect(moves.every((touch) => touch.type === "touchMove")).toBe(true);
		expect(moves.at(-1)?.points).toEqual([end]);
		expect(touches.at(-1)).toEqual({ type: "touchEnd", points: [] });
		expect(harness.browser.wheels).toEqual([]);
		// A finger that moved does not click.
		expect(harness.browser.clicks).toEqual([]);
		await session.quit();
	});

	test("a popup the page opens takes the session's preset, not its own window size", async () => {
		const harness = webCdpLane({ viewport: "mobile" });
		const { session } = await open(harness);
		const popup = harness.browser.openPage("https://accounts.example.com/signin", {
			fromFrontPage: true,
			viewport: POPUP,
		});
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn(popup)).toEqual([{ x: MOBILE.width, y: MOBILE.height }]);
		expect(harness.browser.emulation(popup)).toMatchObject({ mobile: true, touch: true });
		await session.quit();
	});
});
