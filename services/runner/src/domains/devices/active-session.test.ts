import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { LaneFactory, LaneName } from "./lane";
import * as actualSession from "./session";

type FakeSession = { quitCalls: number; healthy: boolean };

function fakeSession(deviceId: string, lane: LaneName): unknown {
	const session = {
		deviceId,
		quitCalls: 0,
		healthy: true,
		lane,
		stream: { ready: true, port: 9100, upstreamUrl: "http://127.0.0.1:9100/" },
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

function fakeLane(lane: LaneName): LaneFactory {
	return async (options) => {
		createdCount += 1;
		const session = fakeSession(options.deviceId, lane);
		createdFakeSessions.push(session as FakeSession);
		return session as Awaited<ReturnType<LaneFactory>>;
	};
}

// Keep every real export (session.test.ts relies on them) and open sessions through
// the real Lane selection with fake Lane factories, so no device or Appium is needed.
const realCreateDeviceSession = actualSession.createDeviceSession;
mock.module("./session", () => ({
	...actualSession,
	createDeviceSession: (options: actualSession.SessionOptions) =>
		realCreateDeviceSession(options, { appium: fakeLane("appium"), direct: fakeLane("direct") }),
}));

mock.module("./mjpeg-proxy", () => ({
	abortAllMjpegProxies: () => {},
}));

const {
	SessionBusyError,
	acquireSessionForRun,
	connectDevice,
	disconnectDevice,
	getActiveSession,
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

afterEach(async () => {
	// A failed test must not leave the session held for the next one.
	const current = getActiveSession();
	if (current?.heldByRunId) {
		await releaseSessionFromRun(current.heldByRunId, current.session, true);
	}
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
		expect(createdFakeSessions[1]?.quitCalls).toBe(1);
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

	test("a Run that requests Appium with no Active Session gets an Appium session", async () => {
		await disconnectDevice();
		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			requestedLane: "appium",
		});
		expect(acquired.session.lane).toBe("appium");
		expect(getActiveSessionInfo()?.lane).toBe("appium");

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("a Run without custom capabilities adopts a Direct Active Session", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		expect(getActiveSessionInfo()?.lane).toBe("direct");

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			requestedLane: "appium",
		});
		expect(createdCount).toBe(1);
		expect(acquired.session.lane).toBe("direct");

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("a capability-pinned Run replaces a Direct Active Session with Appium, with a Lane warning", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const direct = createdFakeSessions[0];

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			appCaps: [{ id: "cap-1", key: "appium:autoLaunch", value: "false" }],
		});
		expect(direct?.quitCalls).toBe(1);
		expect(acquired.session.lane).toBe("appium");
		expect(acquired.session.laneWarning).toMatch(/custom Appium capabilities/i);
		expect(acquired.session.laneWarning).toMatch(/replaced the Direct Active Session/);
		expect(getActiveSessionInfo()?.lane).toBe("appium");
		expect(getActiveSessionInfo()?.heldByRun).toBe(true);

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("a capability-pinned Run adopts an Appium Active Session", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android", requestedLane: "appium" });

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			caseCaps: [{ id: "cap-1", key: "appium:autoLaunch", value: "false" }],
		});
		expect(createdCount).toBe(1);
		expect(acquired.session.lane).toBe("appium");

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("a session held by another Run on the same device is never replaced", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const held = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});

		await expect(
			acquireSessionForRun({
				runId: "run_b",
				deviceId: "dev-1",
				platform: "android",
				appCaps: [{ id: "cap-1", key: "appium:autoLaunch", value: "false" }],
			}),
		).rejects.toBeInstanceOf(SessionBusyError);
		expect(createdFakeSessions[0]?.quitCalls).toBe(0);
		expect(getActiveSessionInfo()?.lane).toBe("direct");

		await releaseSessionFromRun("run_a", held.session, held.shared);
	});
});
