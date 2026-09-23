import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ArgentError, isDeadArgentSessionError } from "../argent/cli";

let delegateCalls: Array<Record<string, unknown>> = [];
const fakeSession = { __fake: "argent-session" };

// Stub the Argent adapter so no `argent` binary is needed. `isDeadSessionError`
// uses the real classifier from `argent/cli` (cycle-free).
mock.module("../argent/session", () => ({
	createArgentDeviceSession: async (options: Record<string, unknown>) => {
		delegateCalls.push({ ...options });
		return fakeSession;
	},
	isDeadArgentSessionError,
}));

const { DeadSessionError, createDeviceSession, isDeadSessionError } = await import("./session");

// `mock.module` leaks across test files on Bun versions with a global mock
// registry (CI pins 1.2.x) — this file's `../argent/session` fake must not
// survive into later files (e.g. active-session.test.ts needs the real chain).
afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	delegateCalls = [];
});

describe("isDeadSessionError", () => {
	test("matches the missing-session message from requireActiveSession", () => {
		expect(
			isDeadSessionError(new Error("No active device session. Run: yoqa devices connect <id>")),
		).toBe(true);
		expect(isDeadSessionError(new DeadSessionError())).toBe(true);
		expect(isDeadSessionError(new Error("Device is busy with another action"))).toBe(false);
	});

	test("treats dead Argent targets as dead sessions", () => {
		expect(isDeadSessionError(new ArgentError("device disconnected", "DEVICE_DISCONNECTED"))).toBe(
			true,
		);
		expect(isDeadSessionError(new ArgentError("tool-server down", "SERVER_UNREACHABLE"))).toBe(
			true,
		);
		expect(isDeadSessionError(new ArgentError("timed out", "TIMEOUT"))).toBe(false);
	});
});

describe("createDeviceSession", () => {
	test("delegates to the Argent adapter and returns its session", async () => {
		const session = await createDeviceSession({ platform: "ios", deviceId: "sim-1" });
		expect(session).toBe(fakeSession as never);
		expect(delegateCalls).toEqual([
			{
				platform: "ios",
				deviceId: "sim-1",
				kind: undefined,
				bundleId: undefined,
				appPackage: undefined,
				activity: undefined,
				onSessionDead: undefined,
			},
		]);
	});

	test("passes kind/bundle/activity through to Argent", async () => {
		const onSessionDead = mock(() => undefined);
		await createDeviceSession({
			platform: "android",
			deviceId: "emu-1",
			kind: "emulator",
			appPackage: "com.example.app",
			activity: ".MainActivity",
			onSessionDead,
		});
		expect(delegateCalls[0]).toMatchObject({
			platform: "android",
			deviceId: "emu-1",
			kind: "emulator",
			appPackage: "com.example.app",
			activity: ".MainActivity",
		});
		expect(delegateCalls[0]?.onSessionDead).toBe(onSessionDead);
	});
});
