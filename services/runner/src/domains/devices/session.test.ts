import { describe, expect, test } from "bun:test";
import { DeadSessionError, isDeadSessionError } from "./session";

describe("isDeadSessionError", () => {
	test("matches the Dead Session error every Direct lane throws", () => {
		expect(isDeadSessionError(new DeadSessionError())).toBe(true);
		expect(isDeadSessionError(new DeadSessionError("Device session ended: device offline"))).toBe(
			true,
		);
	});

	test("does not match ordinary command failures", () => {
		expect(isDeadSessionError(new Error("socket hang up"))).toBe(false);
		expect(isDeadSessionError(new Error("No element matching label: Login"))).toBe(false);
		expect(isDeadSessionError(new Error("MJPEG proxy aborted"))).toBe(false);
	});

	test("does not read WebDriver-era words in a plain error as a Dead Session", () => {
		// No Lane speaks WebDriver any more (ADR-0005); only the type says a session is gone.
		expect(isDeadSessionError(new Error("invalid session id"))).toBe(false);
		expect(isDeadSessionError(new Error("Device session ended"))).toBe(false);
	});
});
