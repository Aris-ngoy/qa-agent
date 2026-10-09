import { describe, expect, test } from "bun:test";
import {
	directImplementationOrder,
	directOptIn,
	hasCustomCapabilities,
	selectLane,
} from "./select-lane";

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

describe("directImplementationOrder", () => {
	const existing = { name: "adb", promoted: true };
	const fresh = { name: "device-android" };

	test("with only the existing implementation, that is the one tried", () => {
		expect(directImplementationOrder([existing]).map((i) => i.name)).toEqual(["adb"]);
	});

	test("a new implementation is skipped until it is opted into", () => {
		expect(directImplementationOrder([fresh, existing]).map((i) => i.name)).toEqual(["adb"]);
	});

	test("opting in tries the new implementation first, then the existing one", () => {
		expect(
			directImplementationOrder([fresh, existing], "device-android").map((i) => i.name),
		).toEqual(["device-android", "adb"]);
	});

	test("a promoted new implementation is used without opting in", () => {
		expect(
			directImplementationOrder([{ ...fresh, promoted: true }, existing]).map((i) => i.name),
		).toEqual(["device-android", "adb"]);
	});

	test("opting into the existing implementation rolls a promoted one back", () => {
		expect(
			directImplementationOrder([{ ...fresh, promoted: true }, existing], "adb").map((i) => i.name),
		).toEqual(["adb"]);
	});
});

describe("directOptIn", () => {
	test("reads the device class's env var", () => {
		expect(directOptIn("android", { YOQA_DIRECT_ANDROID: " device-android " })).toBe(
			"device-android",
		);
		expect(directOptIn("ios-simulator", { YOQA_DIRECT_IOS_SIMULATOR: "device-sim" })).toBe(
			"device-sim",
		);
	});

	test("unset or blank means no opt-in", () => {
		expect(directOptIn("android", {})).toBeUndefined();
		expect(directOptIn("android", { YOQA_DIRECT_ANDROID: "  " })).toBeUndefined();
	});
});
