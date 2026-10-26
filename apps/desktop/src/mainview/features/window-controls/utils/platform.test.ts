import { describe, expect, test } from "bun:test";
import { needsCustomWindowControls } from "./platform";

describe("needsCustomWindowControls", () => {
	test("is true for the WebView2 user agent on Windows", () => {
		expect(
			needsCustomWindowControls(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
			),
		).toBe(true);
	});

	test("is false on macOS and Linux, which keep native controls", () => {
		expect(
			needsCustomWindowControls(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
			),
		).toBe(false);
		expect(needsCustomWindowControls("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")).toBe(
			false,
		);
	});
});
