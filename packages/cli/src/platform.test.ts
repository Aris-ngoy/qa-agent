import { describe, expect, test } from "bun:test";
import { listWebDevices } from "../../../services/runner/src/domains/devices/chromium-browsers";
import { listEverydayDevices } from "../../../services/runner/src/domains/devices/chromium-everyday";
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
		expect(connectPlatform("web-dia", undefined)).toBe("web");
	});

	test("an Everyday browser is web, with no --platform", () => {
		expect(connectPlatform("web-chrome-everyday", undefined)).toBe("web");
		expect(connectPlatform("web-dia-everyday", undefined)).toBe("web");
	});

	test("a Firefox or Safari id is web, so the runner says why it is not supported", () => {
		for (const id of ["web-firefox", "web-safari", "web-firefox-everyday", "web-safari-everyday"]) {
			expect(connectPlatform(id, undefined)).toBe("web");
		}
	});

	test("Arc, Opera and Vivaldi are web in both forms, with no --platform", () => {
		for (const browser of ["arc", "opera", "vivaldi"]) {
			expect(connectPlatform(`web-${browser}`, undefined)).toBe("web");
			expect(connectPlatform(`web-${browser}-everyday`, undefined)).toBe("web");
		}
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
		const everyday = devices.filter((device) => device.id.endsWith("-everyday"));
		expect(everyday.map((device) => everydayBrowserName(device.id))).toEqual(
			everyday.map((device) => device.name.replace(" (everyday)", "")),
		);
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
		expect(everydayBrowserName("web-opera-everyday")).toBe("Opera");
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
