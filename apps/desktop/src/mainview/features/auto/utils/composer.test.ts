import { describe, expect, test } from "bun:test";
import { MODE_OPTIONS, canSend, composerHint, isSendKey } from "@/features/auto/utils/composer";

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
		expect(canSend({ text: "  ", sending: false, replying: false, queueing: false })).toBe(false);
		expect(canSend({ text: "Why?", sending: false, replying: false, queueing: false })).toBe(true);
	});

	test("waits while sending and while a reply is being written", () => {
		expect(canSend({ text: "Why?", sending: true, replying: false, queueing: false })).toBe(false);
		expect(canSend({ text: "Why?", sending: false, replying: true, queueing: false })).toBe(false);
	});

	test("a message that queues (the Run is live) goes while the reply is being written", () => {
		expect(canSend({ text: "Why?", sending: false, replying: true, queueing: true })).toBe(true);
		expect(canSend({ text: "  ", sending: false, replying: true, queueing: true })).toBe(false);
	});
});

describe("composerHint", () => {
	test("says what the mode does, or that Enter queues while the Run is live or messages wait", () => {
		expect(composerHint({ mode: "ask", runLive: false, queueing: false })).toBe(
			"Reads the Test Case and its Runs only.",
		);
		expect(composerHint({ mode: "run", runLive: true, queueing: true })).toBe(
			"Enter queues your message until the run finishes · Esc to stop",
		);
		expect(composerHint({ mode: "run", runLive: false, queueing: true })).toBe(
			"Enter queues your message behind the ones waiting",
		);
	});
});

describe("MODE_OPTIONS", () => {
	test("Ask, Run and Explore all work", () => {
		expect(MODE_OPTIONS.filter((mode) => mode.enabled).map((mode) => mode.id)).toEqual([
			"ask",
			"run",
			"explore",
		]);
	});
});
