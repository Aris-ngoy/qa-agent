import { describe, expect, test } from "bun:test";
import { ArgentError } from "../argent/cli";
import { DeadSessionError, isDeadSessionError, shouldAutoInstallRunnerOnConnect } from "./session";

describe("isDeadSessionError", () => {
	test("matches the missing-session message from requireActiveSession", () => {
		expect(
			isDeadSessionError(new Error("No active device session. Run: yoqa devices connect <id>")),
		).toBe(true);
		expect(isDeadSessionError(new DeadSessionError())).toBe(true);
		expect(isDeadSessionError(new ArgentError("transport not wired", "DEVICE_LOST"))).toBe(true);
		expect(isDeadSessionError(new Error("Device is busy with another action"))).toBe(false);
	});
});

describe("shouldAutoInstallRunnerOnConnect", () => {
	test("is never needed — Argent builds/signs its runner on first interaction", () => {
		expect(shouldAutoInstallRunnerOnConnect()).toBe(false);
	});
});
