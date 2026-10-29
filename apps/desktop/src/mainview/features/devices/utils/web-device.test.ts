import { describe, expect, test } from "bun:test";
import {
	attachDeviceId,
	attachedBrowser,
	browserDevices,
	resetProfileConfirmation,
	resetProfileDone,
	resetProfileRequest,
	screenAspect,
	viewportFor,
	withViewport,
} from "@/features/devices/utils/web-device";
import type { Device } from "@yoqa/runner-client";

const CHROME: Device = {
	id: "web-chrome",
	name: "Google Chrome",
	osVersion: "141.0",
	platform: "web",
	kind: "browser",
	state: "not running",
};

describe("attachDeviceId", () => {
	test("names a user-started Chromium by its debug port", () => {
		expect(attachDeviceId("9222")).toBe("chromium-cdp-9222");
		expect(attachDeviceId(" 9333 ")).toBe("chromium-cdp-9333");
	});

	test("is nothing for a value that is not a port", () => {
		expect(attachDeviceId("")).toBeNull();
		expect(attachDeviceId("0")).toBeNull();
		expect(attachDeviceId("65536")).toBeNull();
		expect(attachDeviceId("92a2")).toBeNull();
		expect(attachDeviceId("-1")).toBeNull();
	});
});

describe("attachedBrowser", () => {
	test("is the browser on that port, at the chosen preset", () => {
		expect(attachedBrowser("chromium-cdp-9222", "mobile")).toEqual({
			id: "chromium-cdp-9222",
			label: "Chromium on port 9222",
			name: "Chromium on port 9222",
			osVersion: "port 9222",
			platform: "web",
			kind: "browser",
			viewport: "mobile",
		});
	});

	test("is nothing for an id that names no port", () => {
		expect(attachedBrowser("web-chrome", "desktop")).toBeNull();
	});
});

describe("browserDevices", () => {
	test("keeps only browsers, for the picker's Browsers tab", () => {
		const phone: Device = { ...CHROME, id: "x", platform: "ios", kind: "simulator" };
		expect(browserDevices([CHROME, phone])).toEqual([CHROME]);
	});
});

describe("viewportFor", () => {
	test("is the chosen preset on web, desktop when none was chosen", () => {
		expect(viewportFor("web", "mobile")).toBe("mobile");
		expect(viewportFor("web", undefined)).toBe("desktop");
	});

	test("is nothing on a phone, whose screen is its own size", () => {
		expect(viewportFor("ios", "mobile")).toBeUndefined();
		expect(viewportFor("android", undefined)).toBeUndefined();
	});
});

describe("withViewport", () => {
	test("names the preset after a browser", () => {
		expect(withViewport("Google Chrome", "web", "mobile")).toBe("Google Chrome · mobile");
		expect(withViewport("Google Chrome", "web", undefined)).toBe("Google Chrome");
	});

	test("leaves a phone's label as it is", () => {
		expect(withViewport("iPhone 16", "ios", "mobile")).toBe("iPhone 16");
	});
});

describe("screenAspect", () => {
	test("is the preset's page size on web", () => {
		expect(screenAspect("web", "desktop")).toBe("1280 / 800");
		expect(screenAspect("web", "mobile")).toBe("390 / 844");
		expect(screenAspect("web", undefined)).toBe("1280 / 800");
	});

	test("is nothing on a phone, which keeps its phone frame", () => {
		expect(screenAspect("ios", undefined)).toBeNull();
		expect(screenAspect("android", "mobile")).toBeNull();
	});
});

describe("resetProfileRequest", () => {
	test("names the browser and the selected app's Kept profile", () => {
		expect(resetProfileRequest("web-chrome", { id: "app_1" })).toEqual({
			browserId: "web-chrome",
			appId: "app_1",
		});
	});

	test("names the default profile when no app is selected", () => {
		expect(resetProfileRequest("web-chrome", null)).toEqual({ browserId: "web-chrome" });
	});
});

describe("resetProfileConfirmation", () => {
	test("says whose logins go: the browser's, for the selected app", () => {
		expect(resetProfileConfirmation("Google Chrome", { name: "Shop" })).toBe(
			"Every login and site setting in Google Chrome's profile for Shop is deleted. Its next connect, and the next Run on it, start signed out.",
		);
	});

	test("names the default profile with no app", () => {
		expect(resetProfileConfirmation("Google Chrome", null)).toStartWith(
			"Every login and site setting in Google Chrome's default profile is deleted.",
		);
	});
});

describe("resetProfileDone", () => {
	test("says the profile was reset when the browser had one", () => {
		expect(
			resetProfileDone(
				"Google Chrome",
				{ name: "Shop" },
				{ appId: "app_1", browserIds: ["web-chrome"] },
			),
		).toBe("Reset Google Chrome's profile for Shop");
	});

	test("says there was nothing to reset when it had none", () => {
		expect(resetProfileDone("Google Chrome", null, { appId: "default", browserIds: [] })).toBe(
			"Nothing to reset: Google Chrome's default profile is already empty",
		);
	});
});
