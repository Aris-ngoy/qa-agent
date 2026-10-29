import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fakeChromium, jpegSize, profileDirOf, readMjpegFrames, startFakeCdp } from "./fake-cdp";
import { type IosDeviceDeps, createIosDeviceSession } from "./ios-device-lane";
import { type IdbExec, createIosDirectSession } from "./ios-direct-lane";
import type { LaneFactory, LaneName } from "./lane";
import * as actualSession from "./session";
import { createWebDirectSession, webDirectDeps } from "./web-direct-lane";

type FakeSession = {
	quitCalls: number;
	healthy: boolean;
	lane: LaneName;
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

/**
 * Bun keeps a module mock for the rest of the process, so later test files (a web Run
 * on a fake Chromium) would get these fake sessions too. Only fake Lanes while this
 * file runs; afterwards the mock opens sessions exactly like the real module.
 */
let fakeLanes = true;
afterAll(() => {
	fakeLanes = false;
});

// Keep every real export (session.test.ts relies on them) and open sessions through
// the real Lane selection with fake Lane factories, so no device is needed.
const realCreateDeviceSession = actualSession.createDeviceSession;
mock.module("./session", () => ({
	...actualSession,
	createDeviceSession: (
		options: actualSession.SessionOptions,
		lanes?: Partial<Record<LaneName, LaneFactory>>,
	) =>
		fakeLanes
			? realCreateDeviceSession(options, { direct: (laneOptions) => directLane(laneOptions) })
			: realCreateDeviceSession(options, lanes),
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
	// A failed test must not leave a session for the next one. Connect no longer
	// drops the current session before the new one has opened.
	const current = getActiveSession();
	if (current?.heldByRunId) {
		await releaseSessionFromRun(current.heldByRunId, current.session, true);
	}
	await disconnectDevice();
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

	test("the Active Session says how the Inspector gets frames: Stream, or Screenshot Poll and why", async () => {
		const streaming = await connectDevice({ deviceId: "dev-1", platform: "android" });
		expect(streaming.streamState).toBe("ready");

		// A cabled iPhone's live preview is a Stream when the runner's recorder starts.
		directLane = (options) => createIosDeviceSession(options, fakePhone().deps);
		const cabled = await connectDevice({ deviceId: PHONE_UDID, platform: "ios" });
		expect(cabled.streamState).toBe("ready");

		// A stream that did not answer at connect time is a failure worth showing.
		const fake = fakeLane("direct");
		directLane = async (options) =>
			Object.assign(await fake(options), {
				stream: { ready: false, port: 9100, upstreamUrl: "http://127.0.0.1:9100/" },
			});
		const failed = await connectDevice({ deviceId: "dev-2", platform: "android" });
		expect(failed.streamState).toBe("failed");
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

	test("auto and an explicit Direct request open a Direct Device Session", async () => {
		const auto = await connectDevice({
			deviceId: "dev-1",
			platform: "android",
			requestedLane: "auto",
		});
		expect(auto.lane).toBe("direct");
		expect(auto.laneWarning).toBeUndefined();
		await disconnectDevice();

		const direct = await connectDevice({
			deviceId: "dev-1",
			platform: "android",
			requestedLane: "direct",
		});
		expect(direct.lane).toBe("direct");
		expect(createdFakeSessions.every((session) => session.lane === "direct")).toBe(true);
	});

	test("a failed Direct start fails the connect and opens no other session", async () => {
		directLane = async () => {
			throw new Error("idb companion refused");
		};

		await expect(
			connectDevice({ deviceId: "dev-1", platform: "android", requestedLane: "auto" }),
		).rejects.toThrow("idb companion refused");
		expect(getActiveSessionInfo()).toBeNull();
		expect(createdCount).toBe(0);

		await expect(
			acquireSessionForRun({
				runId: "run_a",
				deviceId: "dev-1",
				platform: "android",
				requestedLane: "direct",
			}),
		).rejects.toThrow("idb companion refused");
		expect(createdCount).toBe(0);
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

describe("an Action the Lane cannot do", () => {
	test("POST /action answers 422 with why: background-app on web", async () => {
		const browser = startFakeCdp({ viewport: { width: 1280, height: 800 } });
		directLane = (options) => createWebDirectSession(options);
		await connectDevice({ deviceId: `chromium-cdp-${browser.port}`, platform: "web" });

		const response = await createSessionRoutes().request("/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "background-app", seconds: 3 }),
		});
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: "Action not supported",
			detail:
				"background-app is not supported on web: a browser page has no background to send it to",
		});
	});
});

describe("connecting a web device at a Viewport preset", () => {
	const connect = (body: unknown) =>
		createSessionRoutes().request("/devices/connect", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	test("POST /devices/connect opens the session at the preset it names, and says so", async () => {
		const browser = startFakeCdp({ viewport: { width: 900, height: 700 } });
		directLane = (options) => createWebDirectSession(options);
		const response = await connect({
			deviceId: `chromium-cdp-${browser.port}`,
			platform: "web",
			viewport: "mobile",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ platform: "web", viewport: "mobile" });
		expect(browser.emulation()).toMatchObject({
			viewport: { width: 390, height: 844 },
			touch: true,
		});
		expect(await (await createSessionRoutes().request("/devices/active")).json()).toMatchObject({
			viewport: "mobile",
		});
	});

	test("with no preset the session is desktop", async () => {
		const browser = startFakeCdp({ viewport: { width: 900, height: 700 } });
		directLane = (options) => createWebDirectSession(options);
		const response = await connect({ deviceId: `chromium-cdp-${browser.port}`, platform: "web" });
		expect(await response.json()).toMatchObject({ viewport: "desktop" });
		expect(browser.emulation().viewport).toEqual({ width: 1280, height: 800 });
	});

	test("a preset that is not one is a 400", async () => {
		const response = await connect({
			deviceId: "chromium-cdp-9222",
			platform: "web",
			viewport: "tv",
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "viewport must be desktop or mobile" });
	});

	test("a phone has no Viewport preset", async () => {
		const response = await connect({ deviceId: "dev-1", platform: "android" });
		expect(await response.json()).not.toHaveProperty("viewport");
	});
});

/** An installed Chrome whose launches are faked, its Kept profiles under a temporary home. */
function installedChrome() {
	const chromium = fakeChromium({ viewport: { width: 900, height: 700 } });
	const home = mkdtempSync(join(tmpdir(), "yoqa-home-"));
	directLane = (options) =>
		createWebDirectSession(
			options,
			webDirectDeps({
				installedBrowsers: async () => [
					{
						id: "web-chrome",
						name: "Google Chrome",
						version: "141.0",
						executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					},
				],
				spawn: chromium.spawn,
				home,
			}),
		);
	const profiles = () => chromium.launched.map((command) => profileDirOf(command));
	return { chromium, home, profiles };
}

describe("connecting a browser Yoqa launches", () => {
	const connect = (body: unknown) =>
		createSessionRoutes().request("/devices/connect", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	test("POST /devices/connect launches it on the Kept profile of the App it names", async () => {
		const { home, profiles } = installedChrome();
		const response = await connect({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		expect(response.status).toBe(200);
		expect(profiles()).toEqual([join(home, ".yoqa", "browser-profiles", "app_1", "web-chrome")]);
	});

	test("without an App it is the default Kept profile, and disconnecting keeps it", async () => {
		const { home, profiles } = installedChrome();
		await connect({ deviceId: "web-chrome", platform: "web" });
		const kept = join(home, ".yoqa", "browser-profiles", "default", "web-chrome");
		expect(profiles()).toEqual([kept]);
		await disconnectDevice();
		expect(existsSync(kept)).toBe(true);
	});

	test("a connect may ask for a clean profile, which disconnecting deletes", async () => {
		const { home, profiles } = installedChrome();
		await connect({ deviceId: "web-chrome", platform: "web", appId: "app_1", profile: "clean" });
		const [clean] = profiles();
		expect(clean).not.toContain(home);
		await disconnectDevice();
		expect(existsSync(clean ?? "")).toBe(false);
	});

	test("a second connect to the browser whose session is active returns that session", async () => {
		const { chromium } = installedChrome();
		const first = await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		const session = getActiveSession()?.session;
		const second = await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		expect(chromium.launched).toHaveLength(1);
		expect(chromium.kills).toBe(0);
		expect(getActiveSession()?.session).toBe(session);
		expect(second).toEqual(first);
	});

	test("a connect to the same browser for another App, profile or preset replaces the session", async () => {
		const { chromium, profiles } = installedChrome();
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_2" });
		await connectDevice({
			deviceId: "web-chrome",
			platform: "web",
			appId: "app_2",
			profile: "clean",
		});
		await connectDevice({
			deviceId: "web-chrome",
			platform: "web",
			appId: "app_2",
			profile: "clean",
			viewport: "mobile",
		});
		expect(chromium.launched).toHaveLength(4);
		expect(chromium.kills).toBe(3);
		expect(profiles()[1]).toContain(join("app_2", "web-chrome"));
	});

	test("an App id that is not a folder name is a 400", async () => {
		const response = await connect({ deviceId: "web-chrome", platform: "web", appId: "../x" });
		expect(response.status).toBe(400);
	});
});

describe("resetting a Kept profile over DELETE /devices/web/profiles", () => {
	/** An installed Chrome, and the routes over the home its Kept profiles are in. */
	function installedChromeRoutes() {
		const { home } = installedChrome();
		const routes = createSessionRoutes({ home });
		const reset = (query: string) =>
			routes.request(`/devices/web/profiles${query}`, { method: "DELETE" });
		const kept = (app: string) => join(home, ".yoqa", "browser-profiles", app, "web-chrome");
		return { reset, kept };
	}

	test("deletes the Kept profile's folder once its browser is closed", async () => {
		const { reset, kept } = installedChromeRoutes();
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		await disconnectDevice();
		expect(existsSync(kept("app_1"))).toBe(true);

		const response = await reset("?appId=app_1&browserId=web-chrome");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ appId: "app_1", browserIds: ["web-chrome"] });
		expect(existsSync(kept("app_1"))).toBe(false);
	});

	test("without an App or browser it resets every browser's default Kept profile", async () => {
		const { reset, kept } = installedChromeRoutes();
		await connectDevice({ deviceId: "web-chrome", platform: "web" });
		await disconnectDevice();

		const response = await reset("");
		expect(await response.json()).toEqual({ appId: "default", browserIds: ["web-chrome"] });
		expect(existsSync(kept("default"))).toBe(false);
	});

	test("is refused with a 409 while the profile's browser is open, and leaves the folder", async () => {
		const { reset, kept } = installedChromeRoutes();
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });

		for (const query of ["?appId=app_1&browserId=web-chrome", "?appId=app_1"]) {
			const response = await reset(query);
			expect(response.status).toBe(409);
			expect(((await response.json()) as { error: string }).error).toContain("web-chrome");
		}
		expect(existsSync(kept("app_1"))).toBe(true);
		expect(getActiveSessionInfo()?.deviceId).toBe("web-chrome");
	});

	test("is refused with a 409 while another browser holds the profile", async () => {
		const { reset, kept } = installedChromeRoutes();
		mkdirSync(kept("app_1"), { recursive: true });
		// This test process stands in for a live browser on this host.
		symlinkSync(`${hostname()}-${process.pid}`, join(kept("app_1"), "SingletonLock"));

		const response = await reset("?appId=app_1");
		expect(response.status).toBe(409);
		expect(((await response.json()) as { error: string }).error).toContain(kept("app_1"));
		expect(existsSync(kept("app_1"))).toBe(true);
	});

	test("a browser's profile resets while another browser or App has its session open", async () => {
		const { reset, kept } = installedChromeRoutes();
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_1" });
		await disconnectDevice();
		await connectDevice({ deviceId: "web-chrome", platform: "web", appId: "app_2" });

		expect((await reset("?appId=app_1")).status).toBe(200);
		expect((await reset("?appId=app_2&browserId=web-edge")).status).toBe(200);
		expect(existsSync(kept("app_1"))).toBe(false);
		expect(existsSync(kept("app_2"))).toBe(true);
	});

	test("an App id that is not a folder name, or a browser Yoqa does not launch, is a 400", async () => {
		const { reset } = installedChromeRoutes();
		expect((await reset("?appId=..")).status).toBe(400);
		expect((await reset("?browserId=chromium-cdp-9222")).status).toBe(400);
	});
});

describe("the web Frame Feed on /stream.mjpeg", () => {
	/** A mobile web session on a 2× display, and the runner's routes on a real port. */
	async function webSession() {
		const browser = startFakeCdp({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
		directLane = (options) => createWebDirectSession(options);
		const info = await connectDevice({
			deviceId: `chromium-cdp-${browser.port}`,
			platform: "web",
			viewport: "mobile",
		});
		const runner = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: createSessionRoutes().fetch,
		});
		phoneServers.push(runner);
		const watch = async () => {
			const hangUp = new AbortController();
			const response = await fetch(`http://127.0.0.1:${runner.port}${info.streamUrl}`, {
				signal: hangUp.signal,
			});
			return { response, hangUp: () => hangUp.abort() };
		};
		return { browser, info, watch };
	}

	/** Wait up to a second for `check` to hold. */
	async function eventually(check: () => boolean): Promise<boolean> {
		for (let tries = 0; tries < 50 && !check(); tries++) await Bun.sleep(20);
		return check();
	}

	test("a web session reports a Stream, and its frames are JPEGs at the preset's size", async () => {
		const { info, watch } = await webSession();
		expect(info).toMatchObject({ streamState: "ready", streamUrl: "/stream.mjpeg" });
		const { response } = await watch();
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("multipart/x-mixed-replace");
		const frames = await readMjpegFrames(response, 3);
		for (const frame of frames) expect(jpegSize(frame)).toEqual({ width: 390, height: 844 });
	});

	test("the screencast stops when the Inspector hangs up", async () => {
		const { browser, watch } = await webSession();
		const watcher = await watch();
		const reader = watcher.response.body?.getReader();
		await reader?.read();
		expect(browser.screencasting()).toBe(true);
		watcher.hangUp();
		expect(await eventually(() => !browser.screencasting())).toBe(true);
	});

	test("the screencast stops when the session is disconnected", async () => {
		const { browser, watch } = await webSession();
		const reader = (await watch()).response.body?.getReader();
		await reader?.read();
		expect(browser.screencasting()).toBe(true);
		await disconnectDevice();
		expect(await eventually(() => !browser.screencasting())).toBe(true);
	});
});

describe("the screen-changed signal on /ws/control", () => {
	/** The runner's control socket on a real port, as `index.ts` serves it. */
	async function controlSocket() {
		const { controlWebSocket, isControlUpgrade } = await import("../../interfaces/http/control-ws");
		const runner = Bun.serve<{ kind: "control" }>({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, server) {
				if (isControlUpgrade(new URL(request.url).pathname)) {
					if (server.upgrade(request, { data: { kind: "control" } })) return undefined;
				}
				return new Response("not found", { status: 404 });
			},
			websocket: {
				open: (ws) => controlWebSocket.open(ws),
				message: (ws, message) => void controlWebSocket.message(ws, message),
				close: (ws, code, reason) => controlWebSocket.close(ws, code, reason),
			},
		});
		phoneServers.push(runner);
		const messages: unknown[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${runner.port}/ws/control`);
		ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
		await new Promise((resolve) => {
			ws.onopen = resolve;
		});
		const screenChanges = () =>
			messages.filter((message) => (message as { type?: string }).type === "screen-changed").length;
		return { ws, screenChanges };
	}

	async function eventually(check: () => boolean): Promise<boolean> {
		for (let tries = 0; tries < 50 && !check(); tries++) await Bun.sleep(20);
		return check();
	}

	test("the Active Session's web page navigating reaches every open control socket", async () => {
		const browser = startFakeCdp({ viewport: { width: 900, height: 700 } });
		directLane = (options) => createWebDirectSession(options);
		await connectDevice({ deviceId: `chromium-cdp-${browser.port}`, platform: "web" });
		const first = await controlSocket();
		const second = await controlSocket();
		await Bun.sleep(400);
		const before = first.screenChanges();
		browser.navigate("https://app.example.com/next");
		expect(await eventually(() => first.screenChanges() > before)).toBe(true);
		expect(await eventually(() => second.screenChanges() > 0)).toBe(true);
		first.ws.close();
		second.ws.close();
	});

	test("a closed control socket hears nothing more", async () => {
		const browser = startFakeCdp({ viewport: { width: 900, height: 700 } });
		directLane = (options) => createWebDirectSession(options);
		await connectDevice({ deviceId: `chromium-cdp-${browser.port}`, platform: "web" });
		const { ws } = await controlSocket();
		const { controlWebSocket } = await import("../../interfaces/http/control-ws");
		expect(controlWebSocket.listening()).toBe(1);
		ws.close();
		expect(await eventually(() => controlWebSocket.listening() === 0)).toBe(true);
	});
});
