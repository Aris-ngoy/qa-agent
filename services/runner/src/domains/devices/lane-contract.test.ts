import { describe, expect, test } from "bun:test";
import { readdir, unlink } from "node:fs/promises";
import { getScreen } from "./interaction";
import { isDeadSessionError } from "./lane";
import {
	BUTTON,
	DEVICE,
	type LaneHarness,
	androidAdbLane,
	androidDevtoolsLane,
	androidLatestFrameLane,
	appiumLane,
	frameAfterTaps,
	iosIdbLane,
} from "./lane-harnesses";
import { SCREENSHOT_DIR } from "./screenshot-retention";

/**
 * What every Lane must do for Actions to work (see `Lane` in CONTEXT.md). A new Lane
 * joins by adding its harness to this list.
 */
const LANES: Array<() => LaneHarness> = [
	appiumLane,
	androidAdbLane,
	androidLatestFrameLane,
	androidDevtoolsLane,
	iosIdbLane,
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
	const name = makeHarness().name;

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

		test("capture-frame returns an image and writes nothing to disk", async () => {
			const { session } = await open(makeHarness());
			const before = await screenshotFiles();
			const frame = await session.captureFrame();
			expect(frame.mime).toMatch(/^image\//);
			expect(Buffer.from(frame.base64, "base64").byteLength).toBeGreaterThan(0);
			expect(await screenshotFiles()).toEqual(before);
		});

		test("capture-frame after a tap shows the screen after that tap", async () => {
			const { session } = await open(makeHarness());
			expect((await session.captureFrame()).base64).toBe(frameAfterTaps(0));
			await session.tap(500, 500);
			expect((await session.captureFrame()).base64).toBe(frameAfterTaps(1));
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
