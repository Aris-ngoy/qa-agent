import { describe, expect, test } from "bun:test";
import {
	KEY_STEP_LARGE_PX,
	KEY_STEP_PX,
	clampWidth,
	readPanelWidth,
	widthFromDrag,
	widthFromKey,
	writePanelWidth,
} from "./panel-width";

const BOUNDS = { min: 300, max: 800 };

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
		removeItem: (key: string) => {
			items.delete(key);
		},
	};
}

describe("clampWidth", () => {
	test("keeps a width inside its bounds", () => {
		expect(clampWidth(200, BOUNDS)).toBe(300);
		expect(clampWidth(900, BOUNDS)).toBe(800);
		expect(clampWidth(512.4, BOUNDS)).toBe(512);
	});

	test("the minimum wins when there is less room than it", () => {
		expect(clampWidth(500, { min: 300, max: 120 })).toBe(300);
	});
});

describe("widthFromDrag", () => {
	test("a handle on the end edge grows the panel when dragged right", () => {
		expect(widthFromDrag(400, 50, "end", BOUNDS)).toBe(450);
		expect(widthFromDrag(400, -50, "end", BOUNDS)).toBe(350);
	});

	test("a handle on the start edge grows the panel when dragged left", () => {
		expect(widthFromDrag(400, -50, "start", BOUNDS)).toBe(450);
		expect(widthFromDrag(400, 50, "start", BOUNDS)).toBe(350);
	});

	test("stops at the bounds", () => {
		expect(widthFromDrag(400, 10_000, "end", BOUNDS)).toBe(800);
		expect(widthFromDrag(400, 10_000, "start", BOUNDS)).toBe(300);
	});
});

describe("widthFromKey", () => {
	test("arrow keys step toward the growing side", () => {
		expect(widthFromKey(400, "ArrowRight", false, "end", BOUNDS)).toBe(400 + KEY_STEP_PX);
		expect(widthFromKey(400, "ArrowLeft", false, "start", BOUNDS)).toBe(400 + KEY_STEP_PX);
		expect(widthFromKey(400, "ArrowLeft", true, "end", BOUNDS)).toBe(400 - KEY_STEP_LARGE_PX);
	});

	test("Home and End jump to the bounds; other keys are ignored", () => {
		expect(widthFromKey(400, "Home", false, "end", BOUNDS)).toBe(300);
		expect(widthFromKey(400, "End", false, "end", BOUNDS)).toBe(800);
		expect(widthFromKey(400, "Enter", false, "end", BOUNDS)).toBeNull();
	});
});

describe("stored width", () => {
	test("reads back what was written", () => {
		const storage = memoryStorage();
		writePanelWidth("k", 432.6, storage);
		expect(readPanelWidth("k", storage)).toBe(433);
	});

	test("writing null forgets the width", () => {
		const storage = memoryStorage({ k: "420" });
		writePanelWidth("k", null, storage);
		expect(readPanelWidth("k", storage)).toBeNull();
	});

	test("ignores junk and missing storage", () => {
		expect(readPanelWidth("k", memoryStorage({ k: "wide" }))).toBeNull();
		expect(readPanelWidth("k", memoryStorage({ k: "-3" }))).toBeNull();
		expect(readPanelWidth("k", null)).toBeNull();
	});
});
