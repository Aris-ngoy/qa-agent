import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ArgentError, resetRunArgentToolForTests, setRunArgentToolForTests } from "../argent/cli";
import { resetArgentSessionsForTests } from "../argent/session";
import { DeadSessionError, createDeviceSession, isDeadSessionError } from "./session";

type ToolCall = { tool: string; args: string[] };

let toolCalls: ToolCall[] = [];

afterAll(() => {
	resetRunArgentToolForTests();
});

beforeEach(() => {
	toolCalls = [];
	resetArgentSessionsForTests();
	// Exercise the real delegation chain (devices/session -> argent/session)
	// with a canned backend. Installed at test-run time: `mock.module`
	// on `../argent/session` leaks a fake session into sibling files on
	// Bun 1.2.x's global mock registry (the CI failure this fixes).
	setRunArgentToolForTests(async (toolName: string, args: string[] = []) => {
		toolCalls.push({ tool: toolName, args: [...args] });
		if (toolName === "list-devices") {
			return { devices: [{ udid: "sim-1" }, { udid: "emu-1" }] };
		}
		return { ok: true };
	});
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
	test("delegates to the Argent adapter and launches the default iOS target", async () => {
		const session = await createDeviceSession({ platform: "ios", deviceId: "sim-1" });
		// Real Argent session (not a fake): has device actions and quits cleanly.
		expect(typeof session.tap).toBe("function");
		expect(typeof session.quit).toBe("function");
		const launch = toolCalls.find((call) => call.tool === "launch-app");
		expect(launch?.args).toEqual(["--udid", "sim-1", "--bundleId", "com.apple.Preferences"]);
		await session.quit();
	});

	test("passes kind/bundle/activity through to Argent", async () => {
		const onSessionDead = mock(() => undefined);
		const session = await createDeviceSession({
			platform: "android",
			deviceId: "emu-1",
			kind: "emulator",
			appPackage: "com.example.app",
			activity: ".MainActivity",
			onSessionDead,
		});
		const launch = toolCalls.find((call) => call.tool === "launch-app");
		expect(launch?.args).toEqual([
			"--udid",
			"emu-1",
			"--bundleId",
			"com.example.app",
			"--activity",
			".MainActivity",
		]);
		await session.quit();
	});
});
