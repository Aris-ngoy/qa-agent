import { describe, expect, test } from "bun:test";
import { readdir, unlink } from "node:fs/promises";
import { KEY_MODIFIERS, KEY_NAMES } from "@yoqa/runner-client";
import { pngSizeFromBase64 } from "./android-gestures";
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

/** A sign-in popup's viewport, smaller than the page that opens it. */
const POPUP = { width: 500, height: 600 };

/**
 * What the web Direct lane must do for shared cases to keep their meaning in a browser:
 * the gestures a phone has become their mouse and wheel equivalents, and a JavaScript
 * dialog is the alert. A popup the page opens is followed, and left again when it closes.
 * In CSS pixels of the harness's DEVICE-sized viewport.
 */
describe("Lane contract: web Direct (web-only Actions)", () => {
	test("swipe up scrolls the content under its start point down, by the swipe's length", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		await performAction(session, { kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 });
		expect(harness.browser.wheels).toEqual([
			{ x: DEVICE.width / 2, y: DEVICE.height * 0.8, deltaX: 0, deltaY: DEVICE.height * 0.6 },
		]);
		await session.quit();
	});

	test("swipe right scrolls the content left", async () => {
		const harness = webCdpLane();
		const { session } = await open(harness);
		await performAction(session, { kind: "swipe", x: 200, y: 500, x2: 700, y2: 500 });
		expect(harness.browser.wheels).toEqual([
			{ x: DEVICE.width * 0.2, y: DEVICE.height / 2, deltaX: -DEVICE.width / 2, deltaY: 0 },
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
		const start = { x: DEVICE.width * 0.1, y: DEVICE.height / 2 };
		const end = { x: DEVICE.width * 0.9, y: DEVICE.height / 2 };
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

	test("a popup the page opens becomes the page the session drives, at its own viewport", async () => {
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
			{ x: POPUP.width, y: POPUP.height },
			{ x: POPUP.width / 2, y: POPUP.height / 2 },
		]);
		expect(harness.browser.clicksOn("page-1")).toEqual([]);
		expect(pngSizeFromBase64((await session.captureFrame()).base64)).toEqual({
			width: POPUP.width * 2,
			height: POPUP.height * 2,
		});
		expect(await session.getWindowSize()).toEqual(POPUP);
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
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DEVICE.width, y: DEVICE.height }]);
		expect(pngSizeFromBase64((await session.captureFrame()).base64)).toEqual({
			width: DEVICE.width * 2,
			height: DEVICE.height * 2,
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
		expect(harness.browser.clicksOn(popup)).toEqual([{ x: POPUP.width, y: POPUP.height }]);
		harness.browser.closePage(popup);
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DEVICE.width, y: DEVICE.height }]);
		expect(deadCalls()).toBe(0);
		await session.quit();
	});

	test("a new tab the page did not open does not take the session over", async () => {
		const harness = webCdpLane();
		const { session, deadCalls } = await open(harness);
		const tab = harness.browser.openPage("https://example.com/", { viewport: POPUP });
		await Bun.sleep(50);
		await session.tap(1000, 1000);
		expect(harness.browser.clicksOn("page-1")).toEqual([{ x: DEVICE.width, y: DEVICE.height }]);
		expect(harness.browser.clicksOn(tab)).toEqual([]);
		harness.browser.closePage(tab);
		await Bun.sleep(50);
		await session.tap(0, 0);
		expect(harness.browser.clicksOn("page-1")).toHaveLength(2);
		expect(deadCalls()).toBe(0);
		await session.quit();
	});
});
