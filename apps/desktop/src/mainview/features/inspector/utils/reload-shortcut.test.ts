import { describe, expect, test } from "bun:test";
import { isReloadShortcut, isTypingTarget } from "@/features/inspector/utils/reload-shortcut";

const press = (
	key: string,
	held: Partial<Record<"meta" | "ctrl" | "alt" | "shift", true>> = {},
) => ({
	key,
	metaKey: held.meta ?? false,
	ctrlKey: held.ctrl ?? false,
	altKey: held.alt ?? false,
	shiftKey: held.shift ?? false,
});

describe("isReloadShortcut", () => {
	test("F5 and ⌘R reload", () => {
		expect(isReloadShortcut(press("F5"))).toBe(true);
		expect(isReloadShortcut(press("r", { meta: true }))).toBe(true);
		expect(isReloadShortcut(press("R", { meta: true }))).toBe(true);
	});

	test("a hard reload chord, another modifier, or a plain r does not", () => {
		expect(isReloadShortcut(press("F5", { shift: true }))).toBe(false);
		expect(isReloadShortcut(press("r", { meta: true, shift: true }))).toBe(false);
		expect(isReloadShortcut(press("r", { ctrl: true }))).toBe(false);
		expect(isReloadShortcut(press("r", { meta: true, alt: true }))).toBe(false);
		expect(isReloadShortcut(press("F5", { meta: true }))).toBe(false);
		expect(isReloadShortcut(press("r"))).toBe(false);
	});
});

describe("isTypingTarget", () => {
	const element = (tagName: string, isContentEditable = false) =>
		({ tagName, isContentEditable }) as unknown as EventTarget;

	test("fields, selects and editable regions are typing", () => {
		expect(isTypingTarget(element("INPUT"))).toBe(true);
		expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
		expect(isTypingTarget(element("SELECT"))).toBe(true);
		expect(isTypingTarget(element("DIV", true))).toBe(true);
	});

	test("anything else, or no target, is not", () => {
		expect(isTypingTarget(element("BUTTON"))).toBe(false);
		expect(isTypingTarget(element("BODY"))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});
});
