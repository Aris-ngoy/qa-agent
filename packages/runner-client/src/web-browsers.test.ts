import { describe, expect, test } from "bun:test";
import {
	WEB_BROWSERS,
	type WebDevice,
	attachDeviceId,
	everydayBrowserId,
	formatDeviceState,
	installedBrowserId,
	webDeviceOf,
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
});

describe("webDeviceOf", () => {
	// [device id, kind, browser name or port] — null kind: not a web device at all.
	const cases: [string, WebDevice["kind"] | null, string | number | null][] = [
		["web-chrome", "launched", "Google Chrome"],
		["web-dia", "launched", "Dia"],
		["web-vivaldi", "launched", "Vivaldi"],
		["web-chrome-everyday", "everyday", "Google Chrome"],
		["web-opera-everyday", "everyday", "Opera"],
		["chromium-cdp-9222", "port", 9222],
		["chromium-cdp-1", "port", 1],
		["chromium-cdp-65535", "port", 65_535],
		["chromium-cdp-0", null, null],
		["chromium-cdp-65536", null, null],
		["chromium-cdp-123456", null, null],
		["chromium-cdp-", null, null],
		["chromium-cdp-9222x", null, null],
		["web-firefox", "unsupported", null],
		["web-safari-everyday", "unsupported", null],
		["web-foo-everyday", null, null],
		["web-chrome-everyday-everyday", null, null],
		["web-", null, null],
		["Web-Chrome", null, null],
		["00008110-001A2B3C4D5E", null, null],
		["emulator-5554", null, null],
		["", null, null],
	];

	test.each(cases)("%s is %s", (id, kind, detail) => {
		const device = webDeviceOf(id);
		expect(device?.kind ?? null).toBe(kind);
		if (!device) return;
		expect(device.id).toBe(id);
		if (device.kind === "port") expect(device.port).toBe(detail as number);
		else expect<string | null>(device.browser?.name ?? null).toBe(detail as string | null);
	});

	test("the id builders are its inverse", () => {
		for (const { browser } of WEB_BROWSERS) {
			expect(webDeviceOf(installedBrowserId(browser))).toMatchObject({ kind: "launched" });
			expect(webDeviceOf(everydayBrowserId(browser))).toMatchObject({ kind: "everyday" });
		}
		expect(webDeviceOf(attachDeviceId(9333))).toMatchObject({ kind: "port", port: 9333 });
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
