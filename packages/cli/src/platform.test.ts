import { describe, expect, test } from "bun:test";
import { listWebDevices } from "../../../services/runner/src/domains/devices/chromium-browsers";
import { listEverydayDevices } from "../../../services/runner/src/domains/devices/chromium-everyday";
import { PLATFORM_DEVICES_DESCRIPTION, connectPlatform, parsePlatform } from "./platform";

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

	test("a Firefox or Safari id is web, so the runner says why it is not supported", () => {
		expect(connectPlatform("web-safari-everyday", undefined)).toBe("web");
	});

	test("every id the runner lists is web, so the CLI never refuses a listed browser", async () => {
		const everyBrowser = {
			platform: "darwin" as const,
			home: "/Users/qa",
			isExecutable: async (path: string) => path.startsWith("/Applications/"),
			readText: async () => "",
			fetch: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
		};
		const devices = [
			...(await listWebDevices({}, everyBrowser)),
			...(await listEverydayDevices({}, everyBrowser)),
		];
		expect(devices).toHaveLength(16);
		for (const device of devices) {
			expect(connectPlatform(device.id, undefined)).toBe("web");
		}
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

describe("PLATFORM_DEVICES_DESCRIPTION", () => {
	test("describes each platform's device list", () => {
		expect(PLATFORM_DEVICES_DESCRIPTION).toEqual({
			ios: "List iOS devices and simulators",
			android: "List Android devices and emulators",
			web: "List installed web browsers and your Everyday browsers (CI: attach a Chromium you started by naming its port, chromium-cdp-<port>)",
		});
	});
});
