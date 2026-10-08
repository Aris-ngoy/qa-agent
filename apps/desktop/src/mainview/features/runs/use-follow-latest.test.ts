import { describe, expect, test } from "bun:test";
import { isNearBottom } from "./use-follow-latest";

describe("isNearBottom", () => {
	test("is true when the list is scrolled to the end", () => {
		expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
	});

	test("tolerates a few pixels of slack, but not a screenful", () => {
		expect(isNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 })).toBe(true);
		expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false);
	});

	test("a list that fits without scrolling is at the bottom", () => {
		expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
	});
});
