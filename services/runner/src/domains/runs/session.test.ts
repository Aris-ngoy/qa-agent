import { describe, expect, test } from "bun:test";
import { mergeCapabilities } from "./session";

describe("mergeCapabilities", () => {
	test("case caps override app caps on the same key", () => {
		expect(
			mergeCapabilities(
				[
					{ key: "autoLaunch", value: "true" },
					{ key: "appPackage", value: "com.app" },
				],
				[
					{ key: "autoLaunch", value: "false" },
					{ key: "appActivity", value: ".Main" },
				],
			),
		).toEqual({
			autoLaunch: "false",
			appPackage: "com.app",
			appActivity: ".Main",
		});
	});

	test("skips blank capability keys", () => {
		expect(
			mergeCapabilities(
				[
					{ key: "  ", value: "ignored" },
					{ key: "ok", value: "1" },
				],
				[{ key: "", value: "nope" }],
			),
		).toEqual({ ok: "1" });
	});
});
