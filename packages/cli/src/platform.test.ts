import { describe, expect, test } from "bun:test";
import { PLATFORM_DEVICES_DESCRIPTION, parsePlatform } from "./platform";

describe("parsePlatform", () => {
	test("accepts each platform", () => {
		expect(parsePlatform("ios")).toBe("ios");
		expect(parsePlatform("android")).toBe("android");
	});

	test("rejects anything else with the platforms it takes", () => {
		expect(() => parsePlatform("windows")).toThrow("--platform must be ios or android");
		expect(() => parsePlatform(undefined)).toThrow("--platform must be ios or android");
	});
});

describe("PLATFORM_DEVICES_DESCRIPTION", () => {
	test("describes each platform's device list", () => {
		expect(PLATFORM_DEVICES_DESCRIPTION).toEqual({
			ios: "List iOS devices and simulators",
			android: "List Android devices and emulators",
		});
	});
});
