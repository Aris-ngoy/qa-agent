import { describe, expect, test } from "bun:test";
import { isDeviceSessionGone } from "./inspect-session";

describe("isDeviceSessionGone", () => {
	test("matches runner 410 payloads", () => {
		expect(isDeviceSessionGone(new Error("Device session ended"))).toBe(true);
		expect(
			isDeviceSessionGone(
				new Error("Device session ended: A session is either terminated or not started"),
			),
		).toBe(true);
		expect(isDeviceSessionGone(new Error("Get screen failed: HTTP 410"))).toBe(true);
	});

	test("does not treat ordinary action or screen errors as death", () => {
		expect(isDeviceSessionGone(new Error("Failed to refresh screen tree"))).toBe(false);
		expect(isDeviceSessionGone(new Error("No element matching label: Login"))).toBe(false);
		expect(isDeviceSessionGone(new Error("MJPEG proxy aborted"))).toBe(false);
	});
});
