import { describe, expect, test } from "bun:test";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, formatPageRange, pageFor, paginate } from "./paginate";

const items = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe("paginate", () => {
	test("shows 20 rows a page by default, and never fewer", () => {
		expect(DEFAULT_PAGE_SIZE).toBe(20);
		expect(Math.min(...PAGE_SIZES)).toBe(20);
	});

	test("slices the requested 1-based page", () => {
		const slice = paginate(items(57), 2, 20);
		expect(slice.items).toEqual(items(40).slice(20));
		expect(slice).toMatchObject({ page: 2, pageCount: 3, total: 57, first: 21, last: 40 });
	});

	test("the last page holds the remainder", () => {
		const slice = paginate(items(57), 3, 20);
		expect(slice.items).toEqual([
			41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
		]);
		expect(slice).toMatchObject({ page: 3, first: 41, last: 57 });
	});

	test("clamps a page past the end, so deleting the last row of a page lands on the new last page", () => {
		const slice = paginate(items(40), 3, 20);
		expect(slice).toMatchObject({ page: 2, pageCount: 2, first: 21, last: 40 });
	});

	test("clamps a page below 1", () => {
		expect(paginate(items(5), 0, 20).page).toBe(1);
	});

	test("an empty list is one empty page", () => {
		expect(paginate([], 4, 20)).toEqual({
			items: [],
			page: 1,
			pageCount: 1,
			total: 0,
			first: 0,
			last: 0,
		});
	});
});

describe("formatPageRange", () => {
	test("names the rows on screen out of the total", () => {
		expect(formatPageRange(paginate(items(57), 2, 20))).toBe("21–40 of 57");
	});

	test("reads 0 of 0 when there is nothing to show", () => {
		expect(formatPageRange(paginate([], 1, 20))).toBe("0 of 0");
	});
});

describe("pageFor", () => {
	test("keeps the stored page while the reset key is unchanged", () => {
		expect(pageFor({ page: 3, key: "failed" }, "failed")).toBe(3);
	});

	test("starts again from page 1 when the reset key changes", () => {
		expect(pageFor({ page: 3, key: "failed" }, "passed")).toBe(1);
	});
});
