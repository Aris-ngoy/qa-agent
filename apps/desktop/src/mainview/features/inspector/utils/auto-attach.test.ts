import { describe, expect, test } from "bun:test";
import { inspectorSessionKey, shouldAutoAttach } from "./auto-attach";

describe("shouldAutoAttach", () => {
	test("attaches when a device session is up and the feed is idle", () => {
		expect(
			shouldAutoAttach({
				deviceId: "phone",
				connectedAt: 1,
				attachedDeviceId: null,
				suppressedKey: null,
			}),
		).toBe(true);
	});

	test("does not attach again to the session already on screen", () => {
		expect(
			shouldAutoAttach({
				deviceId: "phone",
				connectedAt: 1,
				attachedDeviceId: "phone",
				suppressedKey: null,
			}),
		).toBe(false);
	});

	test("stays off after Disconnect until that session is replaced", () => {
		const suppressedKey = inspectorSessionKey("phone", 1);
		expect(
			shouldAutoAttach({
				deviceId: "phone",
				connectedAt: 1,
				attachedDeviceId: null,
				suppressedKey,
			}),
		).toBe(false);
		expect(
			shouldAutoAttach({
				deviceId: "phone",
				connectedAt: 2,
				attachedDeviceId: null,
				suppressedKey,
			}),
		).toBe(true);
	});

	test("does nothing without a device session", () => {
		expect(
			shouldAutoAttach({
				deviceId: null,
				connectedAt: null,
				attachedDeviceId: null,
				suppressedKey: null,
			}),
		).toBe(false);
	});
});
