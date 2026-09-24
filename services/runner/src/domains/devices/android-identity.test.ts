import { describe, expect, test } from "bun:test";
import { matchAndroidAppiumIdentity, parseAdbEmuAvdName } from "./android-identity";

const pixel10 = { serial: "emulator-5554", avdName: "Pixel_10" };
const pixel8 = { serial: "emulator-5556", avdName: "Pixel_8" };
const physical = { serial: "R58M52ABCDE", avdName: null };

describe("matchAndroidAppiumIdentity", () => {
	test("maps a running AVD name to its ADB serial", () => {
		expect(
			matchAndroidAppiumIdentity("Pixel_10", [pixel10, physical], ["Pixel_10", "Pixel_8"]),
		).toEqual({
			udid: "emulator-5554",
			avd: "Pixel_10",
		});
	});

	test("keeps an ADB emulator serial and fills in the AVD name", () => {
		expect(matchAndroidAppiumIdentity("emulator-5554", [pixel10], ["Pixel_10"])).toEqual({
			udid: "emulator-5554",
			avd: "Pixel_10",
		});
	});

	test("picks the matching emulator when several are running", () => {
		expect(
			matchAndroidAppiumIdentity("Pixel_8", [pixel10, pixel8], ["Pixel_10", "Pixel_8"]),
		).toEqual({
			udid: "emulator-5556",
			avd: "Pixel_8",
		});
	});

	test("omits udid for a known AVD that is not running so Appium can launch it", () => {
		expect(matchAndroidAppiumIdentity("Pixel_10", [physical], ["Pixel_10", "Pixel_8"])).toEqual({
			avd: "Pixel_10",
		});
	});

	test("passes a connected physical serial through as udid", () => {
		expect(matchAndroidAppiumIdentity("R58M52ABCDE", [pixel10, physical], ["Pixel_10"])).toEqual({
			udid: "R58M52ABCDE",
		});
	});

	test("passes an unknown id through as udid (physical not yet listed)", () => {
		expect(matchAndroidAppiumIdentity("R58M52ABCDE", [pixel10], ["Pixel_10"])).toEqual({
			udid: "R58M52ABCDE",
		});
	});

	test("ignores surrounding whitespace on the device id", () => {
		expect(matchAndroidAppiumIdentity("  Pixel_10  ", [pixel10], ["Pixel_10"])).toEqual({
			udid: "emulator-5554",
			avd: "Pixel_10",
		});
	});

	test("returns empty identity for a blank device id", () => {
		expect(matchAndroidAppiumIdentity("  ", [pixel10])).toEqual({});
	});
});

describe("parseAdbEmuAvdName", () => {
	test("reads the AVD name before the OK status line", () => {
		expect(parseAdbEmuAvdName("Pixel_10\nOK\n")).toBe("Pixel_10");
	});

	test("returns null when the emulator console prints nothing", () => {
		expect(parseAdbEmuAvdName("")).toBeNull();
		expect(parseAdbEmuAvdName("OK\n")).toBeNull();
	});
});
