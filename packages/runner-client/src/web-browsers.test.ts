import { describe, expect, test } from "bun:test";
import {
	WEB_BROWSERS,
	everydayBrowserId,
	formatDeviceState,
	installedBrowserId,
	webBrowserOf,
} from "./web-browsers";

describe("WEB_BROWSERS", () => {
	test("lists the five checked browsers, then Arc, Opera and Vivaldi unverified", () => {
		expect(WEB_BROWSERS.map(({ browser, verified }) => [browser, verified])).toEqual([
			["chrome", true],
			["edge", true],
			["brave", true],
			["chromium", true],
			["dia", true],
			["arc", false],
			["opera", false],
			["vivaldi", false],
		]);
	});

	test("each browser has a launched and an Everyday id", () => {
		expect(installedBrowserId("arc")).toBe("web-arc");
		expect(everydayBrowserId("opera")).toBe("web-opera-everyday");
	});

	test("a device id names its browser in either form", () => {
		expect(webBrowserOf("web-vivaldi")?.name).toBe("Vivaldi");
		expect(webBrowserOf("web-chrome-everyday")?.name).toBe("Google Chrome");
		expect(webBrowserOf("web-firefox")).toBeUndefined();
		expect(webBrowserOf("chromium-cdp-9222")).toBeUndefined();
	});
});

describe("formatDeviceState", () => {
	test("adds unverified to the state of a browser not yet checked", () => {
		expect(formatDeviceState({ state: "not running", verified: false })).toBe(
			"not running · unverified",
		);
		expect(formatDeviceState({ verified: false })).toBe("unverified");
	});

	test("is the state alone for a verified browser or a phone", () => {
		expect(formatDeviceState({ state: "ready", verified: true })).toBe("ready");
		expect(formatDeviceState({ state: "Booted" })).toBe("Booted");
		expect(formatDeviceState({})).toBeNull();
	});
});
