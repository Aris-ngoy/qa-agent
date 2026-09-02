/**
 * Type into the focused field. WebDriverAgent rejects WebdriverIO's `keys()`
 * chord (every keyDown, then every keyUp). Pair each keyDown with its keyUp.
 */

export type KeyboardBrowser = {
	execute: (command: string, params?: object) => Promise<unknown>;
	performActions: (actions: object[]) => Promise<void>;
	releaseActions: () => Promise<void>;
};

export type TypeTextResult = "mobile" | "w3c" | "noop";

/** True when the driver does not implement the requested Appium mobile command. */
export function isUnsupportedCommandError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unknown command|unknown method|not (yet )?(been )?implemented|not (yet )?supported|does not support/i.test(
		message,
	);
}

type KeyStroke = { type: "keyDown" | "keyUp"; value: string };

function w3cKeyActions(text: string): object[] {
	const actions: KeyStroke[] = [];
	for (const ch of text) {
		actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
	}
	return [{ type: "key", id: "keyboard", actions }];
}

async function w3cType(browser: KeyboardBrowser, text: string): Promise<void> {
	await browser.performActions(w3cKeyActions(text));
	try {
		await browser.releaseActions();
	} catch {
		// WDA / UIA2 sometimes error on release after a completed action chain.
	}
}

/**
 * Type `text` into the focused element. Prefers `mobile: type` (XCUITest and
 * UiAutomator2); falls back to W3C key actions when that command is missing.
 */
export async function typeText(browser: KeyboardBrowser, text: string): Promise<TypeTextResult> {
	if (text.length === 0) return "noop";
	try {
		await browser.execute("mobile: type", { text });
		return "mobile";
	} catch (error) {
		if (!isUnsupportedCommandError(error)) throw error;
	}
	await w3cType(browser, text);
	return "w3c";
}
