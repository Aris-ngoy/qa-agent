import { describe, expect, test } from "bun:test";
import { RunnerRequestError } from "@yoqa/runner-client";
import {
	feedModeFor,
	isDeviceSessionGone,
	isDeviceUnreachable,
	isStaleSessionReply,
	treeReadPausesStream,
} from "./inspect-session";

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

const WEB_SESSION = {
	deviceId: "web-chrome",
	platform: "web" as const,
	connectedAt: 1,
	streamState: "ready" as const,
	streamReady: true,
	streamUrl: "/stream.mjpeg",
	viewport: "mobile" as const,
};

describe("feedModeFor", () => {
	const SESSION = { deviceId: "dev-1", platform: "ios" as const, connectedAt: 1 };

	test("streams a session whose Stream is ready", () => {
		expect(
			feedModeFor({
				...SESSION,
				streamState: "ready",
				streamReady: true,
				streamUrl: "/stream.mjpeg",
			}),
		).toBe("mjpeg");
		expect(feedModeFor({ ...SESSION, mjpegPort: 9100 })).toBe("mjpeg");
	});

	test("streams a web session's screencast, and never polls its screenshots while it is up", () => {
		expect(feedModeFor(WEB_SESSION)).toBe("mjpeg");
	});

	test("polls when the Stream failed, or there is nothing to stream from", () => {
		expect(
			feedModeFor({
				...SESSION,
				streamState: "failed",
				streamReady: false,
				streamUrl: "/stream.mjpeg",
			}),
		).toBe("poll");
		expect(feedModeFor(SESSION)).toBe("poll");
	});
});

describe("treeReadPausesStream", () => {
	test("a phone's Stream pauses while its tree is read", () => {
		expect(treeReadPausesStream({ deviceId: "dev-1", platform: "ios", connectedAt: 1 })).toBe(true);
	});

	test("a web screencast keeps streaming while the page's tree is read", () => {
		expect(treeReadPausesStream(WEB_SESSION)).toBe(false);
	});
});
