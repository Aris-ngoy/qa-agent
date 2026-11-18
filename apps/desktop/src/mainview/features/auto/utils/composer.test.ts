import { describe, expect, test } from "bun:test";
import { MODE_OPTIONS, canSend, isSendKey } from "@/features/auto/utils/composer";

describe("isSendKey", () => {
	test("Enter sends", () => {
		expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
	});

	test("Shift+Enter, an IME composition, and other keys do not", () => {
		expect(isSendKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
		expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
		expect(isSendKey({ key: "a", shiftKey: false, isComposing: false })).toBe(false);
	});
});

describe("canSend", () => {
	test("needs some text", () => {
		expect(canSend({ text: "  ", sending: false, replying: false })).toBe(false);
		expect(canSend({ text: "Why?", sending: false, replying: false })).toBe(true);
	});

	test("waits while sending and while a reply is being written", () => {
		expect(canSend({ text: "Why?", sending: true, replying: false })).toBe(false);
		expect(canSend({ text: "Why?", sending: false, replying: true })).toBe(false);
	});
});

describe("MODE_OPTIONS", () => {
	test("Ask and Run work for now", () => {
		expect(MODE_OPTIONS.filter((mode) => mode.enabled).map((mode) => mode.id)).toEqual([
			"ask",
			"run",
		]);
	});
});
