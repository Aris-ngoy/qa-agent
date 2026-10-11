import { describe, expect, test } from "bun:test";
import { nextSlots, promoteSlot } from "@/features/inspector/live-frame";

const EMPTY = { a: null, b: null, front: "a" as const };

describe("nextSlots", () => {
	test("first frame goes straight to the front", () => {
		expect(nextSlots(EMPTY, "blob:1")).toEqual({ a: "blob:1", b: null, front: "a" });
	});

	test("later frames load behind the shown one", () => {
		const shown = { a: "blob:1", b: null, front: "a" as const };
		expect(nextSlots(shown, "blob:2")).toEqual({ a: "blob:1", b: "blob:2", front: "a" });
	});

	test("a newer frame replaces one still loading behind", () => {
		const loading = { a: "blob:1", b: "blob:2", front: "a" as const };
		expect(nextSlots(loading, "blob:3")).toEqual({ a: "blob:1", b: "blob:3", front: "a" });
	});

	test("no frame clears both slots", () => {
		expect(nextSlots({ a: "blob:1", b: "blob:2", front: "b" }, null)).toEqual(EMPTY);
	});
});

describe("promoteSlot", () => {
	test("a loaded back frame comes to the front and the old one unmounts", () => {
		const loading = { a: "blob:1", b: "blob:2", front: "a" as const };
		expect(promoteSlot(loading, "b", "blob:2")).toEqual({ a: null, b: "blob:2", front: "b" });
	});

	test("a stale load does not promote a newer frame", () => {
		const loading = { a: "blob:1", b: "blob:3", front: "a" as const };
		expect(promoteSlot(loading, "b", "blob:2")).toBe(loading);
	});
});
