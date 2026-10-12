import { describe, expect, test } from "bun:test";
import { DIRECT_IMPLEMENTATIONS, deviceClassFor } from "./direct-lane";
import { directImplementationOrder, directOptIn, selectLane } from "./select-lane";

describe("selectLane", () => {
	test("fails the connect when Direct is not available", () => {
		expect(() => selectLane({ requested: "auto", available: [] })).toThrow(
			"Direct lane is not available",
		);
	});

	test("auto picks Direct when that lane is available", () => {
		expect(selectLane({ requested: "auto", available: ["direct"] })).toEqual({
			lane: "direct",
			fallback: false,
		});
	});

	test("an explicit Direct request fails when that lane is not available", () => {
		expect(() => selectLane({ requested: "direct", available: [] })).toThrow(
			"Direct lane is not available",
		);
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

describe("Android Direct implementations", () => {
	const names = (optIn?: string) =>
		directImplementationOrder(DIRECT_IMPLEMENTATIONS.android, optIn).map((i) => i.name);

	test("adb stays the default until device-android shows a measured gain", () => {
		expect(names()).toEqual(["adb"]);
	});

	test("YOQA_DIRECT_ANDROID=device-android tries the background capture first", () => {
		expect(names("device-android")).toEqual(["device-android", "adb"]);
	});
});

describe("iOS-simulator Direct implementations", () => {
	const names = (optIn?: string) =>
		directImplementationOrder(DIRECT_IMPLEMENTATIONS["ios-simulator"], optIn).map((i) => i.name);

	test("device-sim is the default, with idb_companion as its fallback", () => {
		expect(names()).toEqual(["device-sim", "idb"]);
	});

	test("YOQA_DIRECT_IOS_SIMULATOR=idb rolls back to idb_companion alone", () => {
		expect(names("idb")).toEqual(["idb"]);
	});
});

describe("physical-iOS Direct lane", () => {
	const PHONE = "00008120-000E6D813E2A601E";
	const SIMULATOR = "B75001FB-B91D-4F94-80A7-3E371A641D27";

	test("a physical iPhone is its own device class, driven by device-ios", () => {
		expect(deviceClassFor("ios", PHONE)).toBe("ios-device");
		expect(deviceClassFor("ios", SIMULATOR)).toBe("ios-simulator");
		expect(DIRECT_IMPLEMENTATIONS["ios-device"].map((i) => i.name)).toEqual(["device-ios"]);
	});

	test("auto picks Direct for a phone", () => {
		expect(selectLane({ available: ["direct"], requested: "auto" })).toEqual({
			lane: "direct",
			fallback: false,
		});
	});
});
