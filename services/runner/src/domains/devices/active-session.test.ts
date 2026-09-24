import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as actualSession from "./session";

type FakeSession = { quitCalls: number; healthy: boolean };

function fakeSession(deviceId: string): unknown {
	const session = {
		deviceId,
		quitCalls: 0,
		healthy: true,
		mjpegPort: 9100,
		streamReady: true,
		getWindowSize: async () => {
			if (!session.healthy) {
				throw new Error("invalid session id");
			}
			return { width: 100, height: 200 };
		},
		quit: async () => {
			session.quitCalls += 1;
		},
	};
	return session;
}

let createdCount = 0;
let createdFakeSessions: FakeSession[] = [];

// Keep every real export (session.test.ts relies on them) and only stub
// session creation so no Appium server is needed.
mock.module("./session", () => ({
	...actualSession,
	createDeviceSession: async (options: { deviceId: string }) => {
		createdCount += 1;
		const session = fakeSession(options.deviceId) as unknown as Record<string, unknown> & {
			deviceId: string;
		};
		createdFakeSessions.push(session as unknown as FakeSession);
		return session;
	},
}));

mock.module("./mjpeg-proxy", () => ({
	abortAllMjpegProxies: () => {},
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

beforeEach(() => {
	// Tests always start from an explicit connect; connectDevice replaces any
	// unheld leftover session from a previous test.
	createdCount = 0;
	createdFakeSessions = [];
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
		const sessionsBeforeAcquire = createdCount;

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
		expect(createdCount).toBe(sessionsBeforeAcquire);
	});

	test("run replaces an unheld Active Session on another device", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "ios" });

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-2",
			platform: "android",
		});
		expect(acquired.shared).toBe(true);
		expect(createdCount).toBe(2);
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
		expect(createdCount).toBe(2);
		expect(getActiveSessionInfo()?.deviceId).toBe("dev-1");
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		await releaseSessionFromRun("run_b", second.session as never, second.shared);
		expect((second.session as unknown as FakeSession).quitCalls).toBe(1);
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		await releaseSessionFromRun("run_a", first.session as never, first.shared);
		expect(getActiveSessionInfo()?.heldByRun).toBe(false);
	});

	test("run replaces a dead Active Session with a fresh one", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const stale = createdFakeSessions.at(0);
		if (!stale) throw new Error("expected a created session");
		stale.healthy = false;

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});
		expect(acquired.shared).toBe(true);
		expect(createdCount).toBe(2);
		expect(acquired.session).not.toBe(stale);
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

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
