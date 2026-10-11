import { describe, expect, test } from "bun:test";
import { coordsFromImageRect, isPickPointModifier } from "./inspect-pointer";

describe("isPickPointModifier", () => {
	test("Control (ctrlKey) enters pick-point mode", () => {
		expect(isPickPointModifier({ ctrlKey: true })).toBe(true);
		expect(isPickPointModifier({ ctrlKey: false })).toBe(false);
	});
});

describe("coordsFromImageRect", () => {
	const rect = { left: 10, top: 20, width: 200, height: 400 };

	test("maps the image box onto a 0–1000 grid", () => {
		expect(coordsFromImageRect(rect, 10, 20)).toEqual({ x: 0, y: 0 });
		expect(coordsFromImageRect(rect, 210, 420)).toEqual({ x: 1000, y: 1000 });
		expect(coordsFromImageRect(rect, 110, 220)).toEqual({ x: 500, y: 500 });
	});

	test("clamps points outside the image", () => {
		expect(coordsFromImageRect(rect, 0, 0)).toEqual({ x: 0, y: 0 });
		expect(coordsFromImageRect(rect, 999, 999)).toEqual({ x: 1000, y: 1000 });
	});

	test("returns null for an empty rect", () => {
		expect(coordsFromImageRect({ left: 0, top: 0, width: 0, height: 10 }, 1, 1)).toBeNull();
	});
});
