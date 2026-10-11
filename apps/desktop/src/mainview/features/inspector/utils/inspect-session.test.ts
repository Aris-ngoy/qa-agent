import { describe, expect, test } from "bun:test";
import { RunnerRequestError } from "@yoqa/runner-client";
import { isDeviceSessionGone, isDeviceUnreachable, isStaleSessionReply } from "./inspect-session";

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

describe("isDeviceUnreachable", () => {
	const answeredBy = { url: "http://127.0.0.1:7420/screenshot/image", runnerPid: "1", date: null };

	test("matches the runner's 503 for an Unreachable Session", () => {
		const error = new RunnerRequestError(
			"Device unreachable: YoqaRunner is briefly unreachable, retrying",
			503,
			{ error: "Device unreachable", graceMs: 20_000 },
			answeredBy,
		);
		expect(isDeviceUnreachable(error)).toBe(true);
		expect(isDeviceSessionGone(error)).toBe(false);
	});

	test("a cached 410 with no runner pid does not end the session", () => {
		const error = new RunnerRequestError(
			"Device session ended: Cannot reach YoqaRunner: usbmuxd does not list iPhone",
			410,
			{
				error: "Device session ended",
				detail: "Device session ended: Cannot reach YoqaRunner: usbmuxd does not list iPhone",
			},
			{ url: "http://127.0.0.1:7420/screen", runnerPid: null, date: null },
		);
		expect(isStaleSessionReply(error)).toBe(true);
		expect(isDeviceSessionGone(error)).toBe(false);
	});

	test("a Dead Session is not merely unreachable", () => {
		const error = new RunnerRequestError(
			"Device session ended: Cannot reach YoqaRunner",
			410,
			{ error: "Device session ended" },
			answeredBy,
		);
		expect(isDeviceUnreachable(error)).toBe(false);
		expect(isDeviceSessionGone(error)).toBe(true);
	});

	test("does not treat other 503s or plain errors as an Unreachable Session", () => {
		const error = new RunnerRequestError("Busy", 503, { error: "Busy" }, answeredBy);
		expect(isDeviceUnreachable(error)).toBe(false);
		expect(isDeviceUnreachable(new Error("Failed to refresh screen"))).toBe(false);
	});
});
