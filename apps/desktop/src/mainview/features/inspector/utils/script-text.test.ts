import { describe, expect, test } from "bun:test";
import { scrollLines } from "./script-text";

describe("scrollLines", () => {
	test("scrolling up swipes the finger down, so the content above comes into view", () => {
		expect(scrollLines("up")).toEqual([
			"  # scroll up",
			"  - swipe: { x: 500, y: 200, x2: 500, y2: 800 }",
		]);
	});

	test("scrolling down swipes the finger up", () => {
		expect(scrollLines("down")[1]).toBe("  - swipe: { x: 500, y: 800, x2: 500, y2: 200 }");
	});

	test("scrolling right swipes the finger left, and left swipes it right", () => {
		expect(scrollLines("right")[1]).toBe("  - swipe: { x: 800, y: 500, x2: 200, y2: 500 }");
		expect(scrollLines("left")[1]).toBe("  - swipe: { x: 200, y: 500, x2: 800, y2: 500 }");
	});
});
