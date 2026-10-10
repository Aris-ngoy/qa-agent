import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createConnection } from "node:net";
import { type IosDeviceDeps, createIosDeviceSession } from "./ios-device-lane";
import { type IdbExec, createIosDirectSession } from "./ios-direct-lane";
import type { LaneFactory, LaneName } from "./lane";
import * as actualSession from "./session";

type FakeSession = {
	quitCalls: number;
	healthy: boolean;
	/** Every target app the session was pointed at, in order. */
	targets: Array<string | undefined>;
};

function fakeSession(deviceId: string, lane: LaneName): unknown {
	const session = {
		deviceId,
		quitCalls: 0,
		healthy: true,
		targets: [] as Array<string | undefined>,
		lane,
		setTargetApp: (appId: string | undefined) => {
			session.targets.push(appId);
		},
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

/** The Direct lane sessions open on; a test may swap in a real Lane with a faked device. */
let directLane: LaneFactory = fakeLane("direct");

// Keep every real export (session.test.ts relies on them) and open sessions through
// the real Lane selection with fake Lane factories, so no device or Appium is needed.
const realCreateDeviceSession = actualSession.createDeviceSession;
mock.module("./session", () => ({
	...actualSession,
	createDeviceSession: (options: actualSession.SessionOptions) =>
		realCreateDeviceSession(options, {
			appium: fakeLane("appium"),
			direct: (laneOptions) => directLane(laneOptions),
		}),
}));

mock.module("./mjpeg-proxy", () => ({
	trackMjpegProxy: () => new AbortController(),
	abortAllMjpegProxies: () => false,
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
	retargetActiveSession,
} = await import("./active-session");
const { createSessionRoutes } = await import("../../interfaces/http/session");

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
	directLane = fakeLane("direct");
});

const PHONE_UDID = "00008120-000E6D813E2A601E";
const SIM_UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";

const phoneServers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => {
	for (const server of phoneServers.splice(0)) server.stop(true);
});

/**
 * A cabled iPhone with `YoqaRunner` on it, faked at the Lane's seams: the tunnel reaches
 * an HTTP server that answers like the runner and records the app each snapshot reads.
 */
function fakePhone() {
	const snapshots: Array<string | undefined> = [];
	const launched: string[][] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const body = (await request.json()) as { command: string; bundleId?: string };
			if (body.command === "snapshot") snapshots.push(body.bundleId);
			const data =
				body.command === "viewport"
					? { width: 393, height: 852 }
					: body.command === "snapshot"
						? { nodes: [] }
						: { state: "ready" };
			return Response.json({ ok: true, data }, { headers: { Connection: "close" } });
		},
	});
	phoneServers.push(server);
	const deps: IosDeviceDeps = {
		startRunner: async () => ({
			port: 54_321,
			exited: new Promise<number>(() => undefined),
			stop: async () => undefined,
		}),
		connect: async () => createConnection(server.port ?? 0, "127.0.0.1"),
		devicectl: async (args) => {
			launched.push(args);
			return { stdout: "", stderr: "", exitCode: 0 };
		},
	};
	return { deps, snapshots, launched };
}

/** An iOS simulator behind idb_companion, faked; records the apps it launches. */
function fakeSimulator() {
	const launched: string[] = [];
	const idb: IdbExec = async (args) => {
		if (args[0] === "launch" && args[1]) launched.push(args[1]);
		const stdout =
			args[0] === "describe"
				? JSON.stringify({
						target_type: "simulator",
						screen_dimensions: { width_points: 402, height_points: 874 },
					})
				: "";
		return { stdout, stderr: "", exitCode: 0 };
	};
	return { idb, launched };
}

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

	test("the Active Session names the Run that holds it, and forgets it at release", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		expect(getActiveSessionInfo()?.heldByRunId).toBeUndefined();

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});
		expect(getActiveSessionInfo()).toMatchObject({ heldByRun: true, heldByRunId: "run_a" });

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
		expect(getActiveSessionInfo()?.heldByRun).toBe(false);
		expect(getActiveSessionInfo()?.heldByRunId).toBeUndefined();
	});

	test("a Run that adopts the Active Session points it at the Run's app", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android", appPackage: "com.app.a" });

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			appPackage: "com.app.b",
		});
		expect(createdCount).toBe(1);
		expect(createdFakeSessions[0]?.targets).toEqual(["com.app.b"]);

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("a Run for app B that adopts a cabled iPhone's session for app A reads B's Screen from its first step", async () => {
		const phone = fakePhone();
		directLane = (options) => createIosDeviceSession(options, phone.deps);
		await connectDevice({ deviceId: PHONE_UDID, platform: "ios", bundleId: "com.app-a" });
		const connected = getActiveSession()?.session;

		const acquired = await acquireSessionForRun({
			runId: "run_b",
			deviceId: PHONE_UDID,
			platform: "ios",
			bundleId: "com.app-b",
		});
		expect(acquired.session).toBe(connected as never);
		await acquired.session.pageSource();
		expect(phone.snapshots).toEqual(["com.app-b"]);
		expect(phone.launched).toEqual([]);

		await releaseSessionFromRun("run_b", acquired.session, acquired.shared);
	});

	test("a Run for app B that adopts a simulator's Direct session for app A relaunches B, not A", async () => {
		const simulator = fakeSimulator();
		directLane = (options) => createIosDirectSession(options, { idb: simulator.idb });
		await connectDevice({ deviceId: SIM_UDID, platform: "ios", bundleId: "com.app-a" });

		const acquired = await acquireSessionForRun({
			runId: "run_b",
			deviceId: SIM_UDID,
			platform: "ios",
			bundleId: "com.app-b",
		});
		expect(simulator.launched).toEqual([]);
		await acquired.session.backgroundApp(0);
		expect(simulator.launched).toEqual(["com.app-b"]);

		await releaseSessionFromRun("run_b", acquired.session, acquired.shared);
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

describe("retargeting the Active Session to another app", () => {
	test("points an unheld session at the new app without reconnecting", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android", appPackage: "com.app.a" });

		const info = retargetActiveSession({ appPackage: "com.app.b", bundleId: "com.ios.b" });
		expect(info.deviceId).toBe("dev-1");
		expect(createdCount).toBe(1);
		expect(createdFakeSessions[0]?.targets).toEqual(["com.app.b"]);
	});

	test("is refused while a Run holds the session", async () => {
		await connectDevice({ deviceId: "dev-1", platform: "android" });
		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
			appPackage: "com.app.a",
		});

		expect(() => retargetActiveSession({ appPackage: "com.app.b" })).toThrow(SessionBusyError);
		expect(createdFakeSessions[0]?.targets).toEqual(["com.app.a"]);

		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);
	});

	test("POST /devices/retarget answers with the session, 409 while a Run holds it, 404 without one", async () => {
		const routes = createSessionRoutes();
		const retarget = (body: unknown) =>
			routes.request("/devices/retarget", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		await connectDevice({ deviceId: "dev-1", platform: "android", appPackage: "com.app.a" });

		const ok = await retarget({ appPackage: "com.app.b" });
		expect(ok.status).toBe(200);
		expect(await ok.json()).toMatchObject({ deviceId: "dev-1", heldByRun: false });
		expect(createdFakeSessions[0]?.targets).toEqual(["com.app.b"]);

		const acquired = await acquireSessionForRun({
			runId: "run_a",
			deviceId: "dev-1",
			platform: "android",
		});
		expect((await retarget({ appPackage: "com.app.c" })).status).toBe(409);
		expect(await (await routes.request("/devices/active")).json()).toMatchObject({
			heldByRun: true,
			heldByRunId: "run_a",
		});
		await releaseSessionFromRun("run_a", acquired.session, acquired.shared);

		await disconnectDevice();
		expect((await retarget({ appPackage: "com.app.c" })).status).toBe(404);
	});

	test("after a switch, the Screen of a cabled iPhone reads the new app", async () => {
		const phone = fakePhone();
		directLane = (options) => createIosDeviceSession(options, phone.deps);
		await connectDevice({ deviceId: PHONE_UDID, platform: "ios", bundleId: "com.app-a" });
		const routes = createSessionRoutes();

		const switched = await routes.request("/devices/retarget", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ bundleId: "com.app-b" }),
		});
		expect(switched.status).toBe(200);
		expect((await routes.request("/screen?pauseMjpeg=0")).status).toBe(200);
		expect(phone.snapshots).toEqual(["com.app-b"]);
		expect(phone.launched).toEqual([]);
	});
});
