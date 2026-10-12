import { describe, expect, test } from "bun:test";
import { isDeadSessionError } from "./session";

describe("isDeadSessionError", () => {
	test("matches session-gone messages", () => {
		expect(isDeadSessionError(new Error("invalid session id"))).toBe(true);
		expect(isDeadSessionError(new Error("A session is either terminated or not started"))).toBe(
			true,
		);
		expect(isDeadSessionError(new Error("The session does not exist"))).toBe(true);
	});

	test("does not match ordinary command failures", () => {
		expect(isDeadSessionError(new Error("socket hang up"))).toBe(false);
		expect(isDeadSessionError(new Error("No element matching label: Login"))).toBe(false);
		expect(isDeadSessionError(new Error("MJPEG proxy aborted"))).toBe(false);
	});
});
