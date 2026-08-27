import { describe, expect, test } from "bun:test";
import {
	type GestureBrowser,
	injectSwipe,
	injectTap,
	isAndroidDriver,
	pngSizeFromBase64,
	preferPointerSize,
	toPx,
} from "./android-gestures";

function pngBase64(width: number, height: number): string {
	const buf = Buffer.alloc(24);
	buf[0] = 0x89;
	buf[1] = 0x50;
	buf[2] = 0x4e;
	buf[3] = 0x47;
	buf.writeUInt32BE(width, 16);
	buf.writeUInt32BE(height, 20);
	return buf.toString("base64");
}

describe("isAndroidDriver / toPx", () => {
	test("detects Android from platformName", () => {
		expect(isAndroidDriver({ capabilities: { platformName: "Android" } })).toBe(true);
		expect(isAndroidDriver({ capabilities: { platformName: "iOS" } })).toBe(false);
	});

	test("scales 0–1000 onto pixels", () => {
		expect(toPx(0, 1080)).toBe(0);
		expect(toPx(1000, 1080)).toBe(1080);
		expect(toPx(500, 1080)).toBe(540);
		expect(toPx(1006, 1000)).toBe(1000);
	});
});

describe("pngSizeFromBase64 / preferPointerSize", () => {
	test("reads IHDR dimensions", () => {
		expect(pngSizeFromBase64(pngBase64(1080, 2340))).toEqual({ width: 1080, height: 2340 });
		expect(pngSizeFromBase64("not-a-png")).toBeNull();
	});

	test("uses screenshot when it matches the window; otherwise keeps window", () => {
		const window = { width: 1080, height: 2200 };
		expect(preferPointerSize(window, { width: 1080, height: 2208 })).toEqual({
			width: 1080,
			height: 2208,
		});
		expect(preferPointerSize(window, { width: 1080, height: 2340 })).toEqual(window);
		expect(preferPointerSize(window, null)).toEqual(window);
	});
});

describe("injectTap / injectSwipe", () => {
	test("Android tap uses clickGesture", async () => {
		const executed: Array<{ command: string; params?: object }> = [];
		const browser: GestureBrowser = {
			capabilities: { platformName: "Android" },
			execute: async (command, params) => {
				executed.push({ command, params });
			},
			performActions: async () => {
				throw new Error("should not W3C");
			},
			releaseActions: async () => {},
		};
		expect(await injectTap(browser, 100, 200, 50)).toBe("clickGesture");
		expect(executed).toEqual([
			{ command: "mobile: clickGesture", params: { x: 100, y: 200, duration: 50 } },
		]);
	});

	test("Android tap falls back to W3C when clickGesture throws", async () => {
		let performed = 0;
		const browser: GestureBrowser = {
			capabilities: { platformName: "Android" },
			execute: async () => {
				throw new Error("missing mobile command");
			},
			performActions: async () => {
				performed += 1;
			},
			releaseActions: async () => {},
		};
		expect(await injectTap(browser, 1, 2, 80)).toBe("w3c");
		expect(performed).toBe(1);
	});

	test("iOS tap uses W3C performActions", async () => {
		let performed = 0;
		const browser: GestureBrowser = {
			capabilities: { platformName: "iOS" },
			execute: async () => {
				throw new Error("should not execute");
			},
			performActions: async () => {
				performed += 1;
			},
			releaseActions: async () => {},
		};
		expect(await injectTap(browser, 10, 20, 50)).toBe("w3c");
		expect(performed).toBe(1);
	});

	test("Android swipe uses dragGesture", async () => {
		const executed: Array<{ command: string; params?: object }> = [];
		const browser: GestureBrowser = {
			capabilities: { platformName: "Android" },
			execute: async (command, params) => {
				executed.push({ command, params });
			},
			performActions: async () => {
				throw new Error("should not W3C");
			},
			releaseActions: async () => {},
		};
		expect(await injectSwipe(browser, 0, 0, 0, 400, 400)).toBe("dragGesture");
		expect(executed[0]?.command).toBe("mobile: dragGesture");
		expect(executed[0]?.params).toMatchObject({ startX: 0, startY: 0, endX: 0, endY: 400 });
	});
});
