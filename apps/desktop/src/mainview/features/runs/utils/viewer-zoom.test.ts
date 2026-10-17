import { describe, expect, test } from "bun:test";
import {
	FIT_VIEW,
	MAX_SCALE,
	MIN_SCALE,
	PHONE_ASPECT,
	actualPixelScale,
	fitSize,
	frameAspect,
	panBy,
	rotateView,
	wheelZoomFactor,
	zoomAt,
	zoomPercent,
	zoomTo,
} from "@/features/runs/utils/viewer-zoom";

const PHONE = { width: 1179, height: 2556 };

describe("fitSize", () => {
	test("fits a portrait screenshot to the stage height", () => {
		const size = fitSize({ width: 1000, height: 800 }, PHONE, 0);
		expect(size.height).toBeCloseTo(800);
		expect(size.width).toBeCloseTo((1179 / 2556) * 800);
	});

	test("a quarter turn fits the long side to the stage width", () => {
		const size = fitSize({ width: 1000, height: 800 }, PHONE, 90);
		// Rotated, the image is 2556 wide on screen, so its unrotated height spans the stage width.
		expect(size.height).toBeCloseTo(1000);
		expect(size.width).toBeCloseTo((1179 / 2556) * 1000);
	});

	test("is empty before the stage or the image has a size", () => {
		expect(fitSize({ width: 0, height: 0 }, PHONE, 0)).toEqual({ width: 0, height: 0 });
		expect(fitSize({ width: 100, height: 100 }, { width: 0, height: 0 }, 0)).toEqual({
			width: 0,
			height: 0,
		});
	});
});

describe("zoomAt", () => {
	test("keeps the point under the cursor in place", () => {
		const point = { x: 120, y: -40 };
		const before = { ...FIT_VIEW, x: 10, y: 5 };
		const after = zoomAt(before, 2, point);
		// The image-local spot under the cursor is the same before and after.
		const localBefore = (point.x - before.x) / before.scale;
		const localAfter = (point.x - after.x) / after.scale;
		expect(localAfter).toBeCloseTo(localBefore);
		expect((point.y - after.y) / after.scale).toBeCloseTo((point.y - before.y) / before.scale);
	});

	test("clamps to the zoom range", () => {
		expect(zoomAt(FIT_VIEW, 1000, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
		expect(zoomAt(FIT_VIEW, 0.001, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
	});

	test("zoomTo the centre does not pan", () => {
		expect(zoomTo(FIT_VIEW, 3)).toEqual({ ...FIT_VIEW, scale: 3 });
	});
});

describe("view changes", () => {
	test("panBy moves the image", () => {
		expect(panBy(FIT_VIEW, 12, -8)).toEqual({ ...FIT_VIEW, x: 12, y: -8 });
	});

	test("rotating turns a quarter and re-fits", () => {
		const zoomed = { scale: 3, x: 40, y: 40, rotation: 0 as const };
		expect(rotateView(zoomed, 1)).toEqual({ ...FIT_VIEW, rotation: 90 });
		expect(rotateView(FIT_VIEW, -1).rotation).toBe(270);
		expect(rotateView({ ...FIT_VIEW, rotation: 270 }, 1).rotation).toBe(0);
	});

	test("wheel scrolling up zooms in and one event is capped", () => {
		expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
		expect(wheelZoomFactor(100, false)).toBeLessThan(1);
		expect(wheelZoomFactor(-100_000, true)).toBe(2);
		expect(wheelZoomFactor(100_000, true)).toBe(0.5);
	});
});

describe("pixel scale", () => {
	test("actual pixels is the natural width over the fitted width", () => {
		expect(actualPixelScale({ width: 393, height: 852 }, PHONE)).toBeCloseTo(3);
	});

	test("the label reads the zoom against real pixels", () => {
		const fitted = { width: 393, height: 852 };
		expect(zoomPercent(FIT_VIEW, fitted, PHONE)).toBe("33%");
		expect(zoomPercent({ ...FIT_VIEW, scale: 3 }, fitted, PHONE)).toBe("100%");
	});
});

describe("frameAspect", () => {
	test("takes the loaded screenshot's shape", () => {
		expect(frameAspect(PHONE, "1280 / 800")).toBeCloseTo(1179 / 2556);
	});

	test("falls back to the web viewport, then a phone", () => {
		expect(frameAspect(null, "1280 / 800")).toBeCloseTo(1.6);
		expect(frameAspect({ width: 0, height: 0 }, null)).toBeCloseTo(PHONE_ASPECT);
		expect(frameAspect(null, "junk")).toBeCloseTo(PHONE_ASPECT);
	});
});
