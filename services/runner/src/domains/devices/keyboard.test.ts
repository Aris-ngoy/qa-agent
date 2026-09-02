import { describe, expect, test } from "bun:test";
import { type KeyboardBrowser, isUnsupportedCommandError, typeText } from "./keyboard";

function fakeBrowser(overrides: Partial<KeyboardBrowser> = {}): KeyboardBrowser & {
	executed: Array<{ command: string; params?: object }>;
	performed: object[][];
	released: number;
} {
	const executed: Array<{ command: string; params?: object }> = [];
	const performed: object[][] = [];
	let released = 0;
	const browser: KeyboardBrowser & {
		executed: typeof executed;
		performed: typeof performed;
		released: number;
	} = {
		executed,
		performed,
		get released() {
			return released;
		},
		execute: async (command, params) => {
			executed.push({ command, params });
		},
		performActions: async (actions) => {
			performed.push(actions);
		},
		releaseActions: async () => {
			released += 1;
		},
		...overrides,
	};
	return browser;
}

describe("isUnsupportedCommandError", () => {
	test("matches unknown / unsupported command messages", () => {
		expect(isUnsupportedCommandError(new Error("unknown command: mobile: type"))).toBe(true);
		expect(isUnsupportedCommandError(new Error("Method has not yet been implemented"))).toBe(true);
		expect(isUnsupportedCommandError(new Error("The driver does not support this"))).toBe(true);
		expect(isUnsupportedCommandError(new Error("unknown method"))).toBe(true);
	});

	test("does not match unrelated failures", () => {
		expect(
			isUnsupportedCommandError(new Error("Key Down action '-' must have a closing Key Up")),
		).toBe(false);
		expect(isUnsupportedCommandError(new Error("element is not visible"))).toBe(false);
	});
});

describe("typeText", () => {
	test("uses mobile: type when the driver supports it", async () => {
		const browser = fakeBrowser();
		expect(await typeText(browser, "hello-world")).toBe("mobile");
		expect(browser.executed).toEqual([
			{ command: "mobile: type", params: { text: "hello-world" } },
		]);
		expect(browser.performed).toEqual([]);
		expect(browser.released).toBe(0);
	});

	test("falls back to paired keyDown/keyUp when mobile: type is unknown", async () => {
		const browser = fakeBrowser({
			execute: async () => {
				throw new Error("unknown command: mobile: type");
			},
		});
		expect(await typeText(browser, "ab-")).toBe("w3c");
		expect(browser.performed).toHaveLength(1);
		expect(browser.performed[0]).toEqual([
			{
				type: "key",
				id: "keyboard",
				actions: [
					{ type: "keyDown", value: "a" },
					{ type: "keyUp", value: "a" },
					{ type: "keyDown", value: "b" },
					{ type: "keyUp", value: "b" },
					{ type: "keyDown", value: "-" },
					{ type: "keyUp", value: "-" },
				],
			},
		]);
		expect(browser.released).toBe(1);
	});

	test("empty text performs nothing", async () => {
		const browser = fakeBrowser({
			execute: async () => {
				throw new Error("should not execute");
			},
			performActions: async () => {
				throw new Error("should not W3C");
			},
		});
		expect(await typeText(browser, "")).toBe("noop");
		expect(browser.executed).toEqual([]);
		expect(browser.performed).toEqual([]);
		expect(browser.released).toBe(0);
	});

	test("propagates non-unsupported errors from mobile: type", async () => {
		const browser = fakeBrowser({
			execute: async () => {
				throw new Error("element is not visible");
			},
			performActions: async () => {
				throw new Error("should not W3C");
			},
		});
		await expect(typeText(browser, "x")).rejects.toThrow("element is not visible");
		expect(browser.performed).toEqual([]);
	});
});
