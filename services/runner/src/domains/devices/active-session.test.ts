import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ArgentError } from "../argent/cli";
import * as actualCli from "../argent/cli";
import { resetArgentSessionsForTests } from "../argent/session";

let knownDevices: string[] = ["dev-1", "dev-2"];
let launchCalls = 0;
let describeDead = false;

// Stub the Argent backend so no `argent` binary is needed. The tests below
// exercise the real delegation chain (active-session -> devices/session ->
// argent/session) with canned tool results.
mock.module("../argent/cli", () => ({
	...actualCli,
	runArgentTool: async (toolName: string, _args: string[] = []) => {
		if (toolName === "list-devices") {
			return { devices: knownDevices.map((udid) => ({ udid })) };
		}
		if (toolName === "launch-app" || toolName === "restart-app") {
			launchCalls += 1;
			return { ok: true };
		}
		if (toolName === "describe") {
			if (describeDead) {
				throw new ArgentError("device disconnected", "DEVICE_DISCONNECTED");
			}
			return { description: "", source: "test" };
		}
		return { ok: true };
	},
}));

const {
	SessionBusyError,
	acquireSessionForRun,
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
	isActiveSessionHeldByRun,
	releaseSessionFromRun,
} = await import("./active-session");

// `mock.module` leaks across test files on Bun versions with a global mock
// registry (CI pins 1.2.x) — file load order then decides which stub wins.
// Restore this file's stubs when done so later files resolve real modules.
afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	// Tests always start from an explicit connect; connectDevice replaces any
	// unheld leftover session from a previous test.
	knownDevices = ["dev-1", "dev-2"];
	launchCalls = 0;
	describeDead = false;
	resetArgentSessionsForTests();
});

describe("shared device session", () => {
	test("connectDevice registers the Active Session", async () => {
		const info = await connectDevice({ deviceId: "dev-1", platform: "android" });
		expect(info.deviceId).toBe("dev-1");
		expect(info.heldByRun).toBe(false);
		expect(isActiveSessionHeldByRun()).toBe(false);
	});

	test("run adopts a matching Active Session and keeps it live after release", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const before = getActiveSessionInfo();
		const launchesBeforeAcquire = launchCalls;

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});
		expect(acquired.shared).toBe(true);
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);
		expect(isActiveSessionHeldByRun()).toBe(true);

		await releaseSessionFromRun("run_a", acquired.session as never, acquired.shared);
		const after = getActiveSessionInfo();
		expect(after?.deviceId).toBe(before?.deviceId);
		expect(after?.heldByRun).toBe(false);
		expect(launchCalls).toBe(launchesBeforeAcquire);
	});

	test("run replaces an unheld Active Session on another device", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "ios" });

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-2",
			platform: "android",
		});
		expect(acquired.shared).toBe(true);
		expect(launchCalls).toBe(2);
		expect(getActiveSessionInfo()?.deviceId).toBe("dev-2");

		await releaseSessionFromRun("run_a", acquired.session as never, acquired.shared);
	});

	test("second run while shared session is held gets a detached session, quit at release", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const first = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});

		const second = await acquireSessionForRun({
			runId: "run_b",
			deviceId: "dev-2",
			platform: "ios",
		});
		expect(second.shared).toBe(false);
		expect(launchCalls).toBe(2);
		expect(getActiveSessionInfo()?.deviceId).toBe("dev-1");
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		let quitCalls = 0;
		const quit = second.session.quit.bind(second.session);
		second.session.quit = async () => {
			quitCalls += 1;
			await quit();
		};
		await releaseSessionFromRun("run_b", second.session as never, second.shared);
		expect(quitCalls).toBe(1);
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		await releaseSessionFromRun("run_a", first.session as never, first.shared);
		expect(getActiveSessionInfo()?.heldByRun).toBe(false);
	});

	test("run replaces a dead Active Session with a fresh one", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const launchesBeforeAcquire = launchCalls;
		describeDead = true;

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});
		expect(acquired.shared).toBe(true);
		expect(launchCalls).toBeGreaterThan(launchesBeforeAcquire);
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		describeDead = false;
		await releaseSessionFromRun("run_a", acquired.session as never, acquired.shared);
	});

	test("interactive connect and disconnect are rejected while a run holds the session", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});

		await expect(connectDevice({ deviceId: "dev-2", platform: "ios" })).rejects.toBeInstanceOf(
			SessionBusyError,
		);
		await expect(disconnectDevice()).rejects.toBeInstanceOf(SessionBusyError);

		await releaseSessionFromRun("run_a", acquired.session as never, acquired.shared);
		const info = await disconnectDevice();
		expect(info?.deviceId).toBe("dev-1");
	});
});
