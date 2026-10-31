import { describe, expect, test } from "bun:test";
import { initialWebRunForm } from "@/features/runs/data/state/web-run-form";
import { runViewport, showsProfileChoice, webRunRequest } from "@/features/runs/utils/web-run";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";

const CHROME = { id: "web-chrome", platform: "web" as const };
const DIA_EVERYDAY = { id: "web-dia-everyday", platform: "web" as const };
const IPHONE = { id: "00008101-0001", platform: "ios" as const };

function session(over: Partial<ActiveDeviceResponse>): ActiveDeviceResponse {
	return { deviceId: "web-chrome", platform: "web", connectedAt: 0, viewport: "mobile", ...over };
}

describe("runViewport", () => {
	test("defaults to the Active Session's preset on that device", () => {
		expect(runViewport(initialWebRunForm(), CHROME, session({}))).toBe("mobile");
	});

	test("defaults to desktop with no session, or a session on another device", () => {
		expect(runViewport(initialWebRunForm(), CHROME, null)).toBe("desktop");
		expect(runViewport(initialWebRunForm(), CHROME, session({ deviceId: "web-edge" }))).toBe(
			"desktop",
		);
	});

	test("is the preset the user picked, whatever the session's", () => {
		const form = { ...initialWebRunForm(), viewport: "desktop" as const };
		expect(runViewport(form, CHROME, session({}))).toBe("desktop");
	});
});

describe("webRunRequest", () => {
	test("names the preset and keeps the Kept profile by asking for none", () => {
		// Omitting `profile` lets a case that asks for `profile: clean` still win.
		expect(webRunRequest(initialWebRunForm(), CHROME, session({}))).toEqual({
			viewport: "mobile",
		});
	});

	test("asks for a clean profile when picked", () => {
		const form = { viewport: "desktop" as const, profile: "clean" as const };
		expect(webRunRequest(form, CHROME, null)).toEqual({ viewport: "desktop", profile: "clean" });
	});

	test("never asks for a profile on an Everyday browser", () => {
		const form = { viewport: null, profile: "clean" as const };
		expect(webRunRequest(form, DIA_EVERYDAY, session({ deviceId: DIA_EVERYDAY.id }))).toEqual({
			viewport: "mobile",
		});
	});

	test("adds nothing for a phone", () => {
		const form = { viewport: "mobile" as const, profile: "clean" as const };
		expect(webRunRequest(form, IPHONE, null)).toEqual({});
	});
});

describe("showsProfileChoice", () => {
	test("is for a browser Yoqa launches, not the Everyday browser or a phone", () => {
		expect(showsProfileChoice(CHROME)).toBe(true);
		expect(showsProfileChoice(DIA_EVERYDAY)).toBe(false);
		expect(showsProfileChoice(IPHONE)).toBe(false);
	});
});
