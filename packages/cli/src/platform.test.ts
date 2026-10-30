import { describe, expect, test } from "bun:test";
import {
	PLATFORM_DEVICES_DESCRIPTION,
	connectPlatform,
	everydayBrowserName,
	parsePlatform,
} from "./platform";

describe("parsePlatform", () => {
	test("accepts each platform", () => {
		expect(parsePlatform("ios")).toBe("ios");
		expect(parsePlatform("android")).toBe("android");
		expect(parsePlatform("web")).toBe("web");
	});

	test("rejects anything else with the platforms it takes", () => {
		expect(() => parsePlatform("windows")).toThrow("--platform must be ios, android or web");
		expect(() => parsePlatform(undefined)).toThrow("--platform must be ios, android or web");
	});
});

describe("connectPlatform", () => {
	test("a user-started Chromium named by its port is web, with no --platform", () => {
		expect(connectPlatform("chromium-cdp-9222", undefined)).toBe("web");
	});

	test("an installed browser is web, with no --platform", () => {
		expect(connectPlatform("web-chrome", undefined)).toBe("web");
		expect(connectPlatform("web-edge", undefined)).toBe("web");
		expect(connectPlatform("web-brave", undefined)).toBe("web");
		expect(connectPlatform("web-chromium", undefined)).toBe("web");
	});

	test("an Everyday browser is web, with no --platform", () => {
		expect(connectPlatform("web-chrome-everyday", undefined)).toBe("web");
		expect(connectPlatform("web-dia-everyday", undefined)).toBe("web");
	});

	test("an explicit --platform wins", () => {
		expect(connectPlatform("emulator-5554", "android")).toBe("android");
		expect(connectPlatform("chromium-cdp-9222", "web")).toBe("web");
	});

	test("any other device still needs --platform", () => {
		expect(() => connectPlatform("emulator-5554", undefined)).toThrow(
			"--platform must be ios, android or web",
		);
	});
});

describe("everydayBrowserName", () => {
	test("names the browser an Everyday id's Allow prompt appears in", () => {
		expect(everydayBrowserName("web-chrome-everyday")).toBe("Google Chrome");
		expect(everydayBrowserName("web-dia-everyday")).toBe("Dia");
	});

	test("is null for any other device", () => {
		expect(everydayBrowserName("web-chrome")).toBeNull();
		expect(everydayBrowserName("chromium-cdp-9222")).toBeNull();
	});
});

describe("PLATFORM_DEVICES_DESCRIPTION", () => {
	test("describes each platform's device list", () => {
		expect(PLATFORM_DEVICES_DESCRIPTION).toEqual({
			ios: "List iOS devices and simulators",
			android: "List Android devices and emulators",
			web: "List installed web browsers and your Everyday browsers (CI: attach a Chromium you started by naming its port, chromium-cdp-<port>)",
		});
	});
});
