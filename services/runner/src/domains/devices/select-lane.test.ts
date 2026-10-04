import { describe, expect, test } from "bun:test";
import { hasCustomCapabilities, selectLane } from "./select-lane";

describe("hasCustomCapabilities", () => {
	test("empty lists are not custom", () => {
		expect(hasCustomCapabilities([], [])).toBe(false);
	});

	test("a Case or App capability pins the Appium lane", () => {
		expect(hasCustomCapabilities([{ key: "appium:autoLaunch" }], [])).toBe(true);
		expect(hasCustomCapabilities([], [{ key: "appWaitActivity" }])).toBe(true);
	});

	test("blank keys do not count", () => {
		expect(hasCustomCapabilities([{ key: "  " }], [])).toBe(false);
	});
});

describe("selectLane", () => {
	test("defaults to Appium when Direct is not available", () => {
		expect(
			selectLane({ requested: "auto", available: ["appium"], appCaps: [], caseCaps: [] }),
		).toEqual({ lane: "appium", fallback: false });
	});

	test("auto-picks Direct when that lane is available", () => {
		expect(
			selectLane({
				requested: "auto",
				available: ["appium", "direct"],
				appCaps: [],
				caseCaps: [],
			}),
		).toEqual({ lane: "direct", fallback: false });
	});

	test("custom capabilities pin Appium even when Direct is requested", () => {
		expect(
			selectLane({
				requested: "direct",
				available: ["appium", "direct"],
				appCaps: [{ key: "appium:autoLaunch" }],
				caseCaps: [],
			}),
		).toEqual({
			lane: "appium",
			fallback: false,
			reason: "capabilities",
			warning: "Custom Appium capabilities pin the Appium lane",
		});
	});

	test("forced Direct falls back to Appium when that lane cannot start", () => {
		expect(
			selectLane({
				requested: "direct",
				available: ["appium"],
				appCaps: [],
				caseCaps: [],
			}),
		).toEqual({
			lane: "appium",
			fallback: true,
			reason: "unsupported",
			warning: "Direct lane is not available; fell back to Appium",
		});
	});

	test("an explicit Appium request stays on Appium even if Direct exists", () => {
		expect(
			selectLane({
				requested: "appium",
				available: ["appium", "direct"],
				appCaps: [],
				caseCaps: [],
			}),
		).toEqual({ lane: "appium", fallback: false });
	});
});
