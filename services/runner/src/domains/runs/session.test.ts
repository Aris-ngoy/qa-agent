import { describe, expect, test } from "bun:test";
import { mergeCapabilities } from "./session";

describe("mergeCapabilities", () => {
	test("case caps override app caps on the same key", () => {
		expect(
			mergeCapabilities(
				[
					{ id: "1", key: "autoLaunch", value: "true" },
					{ id: "2", key: "appPackage", value: "com.app" },
				],
				[
					{ id: "3", key: "autoLaunch", value: "false" },
					{ id: "4", key: "appActivity", value: ".Main" },
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
					{ id: "1", key: "  ", value: "ignored" },
					{ id: "2", key: "ok", value: "1" },
				],
				[{ id: "3", key: "", value: "nope" }],
			),
		).toEqual({ ok: "1" });
	});
});
