import { describe, expect, test } from "bun:test";
import { createDirectLane } from "./direct-lane";
import type { DeviceSession, LaneFactory, SessionOptions } from "./lane";
import { defaultLanesFor, openDeviceSession } from "./open-session";

function options(deviceId: string): SessionOptions {
	return { platform: "android", deviceId, appCaps: [], caseCaps: [] };
}

type FakeLaneSession = DeviceSession & { quitCalls: number };

function fakeLane(): { factory: LaneFactory; created: FakeLaneSession[] } {
	const created: FakeLaneSession[] = [];
	const factory: LaneFactory = async () => {
		const session = {
			lane: "appium",
			stream: null,
			quitCalls: 0,
			quit: async () => {
				session.quitCalls += 1;
			},
		} as unknown as FakeLaneSession;
		created.push(session);
		return session;
	};
	return { factory, created };
}

describe("openDeviceSession (lane dispatcher)", () => {
	test("Android and iOS defaults include Direct", () => {
		expect(defaultLanesFor("android").direct).toBeTruthy();
		expect(defaultLanesFor("ios").direct).toBeTruthy();
	});

	test("creates the session through the Appium lane factory", async () => {
		const { factory, created } = fakeLane();
		const session = await openDeviceSession(options("dev-lane-1"), { appium: factory });
		expect(created).toHaveLength(1);
		expect(session.lane).toBe("appium");
		await session.quit();
	});

	test("a second session for the same device quits the first (one Device Session per device)", async () => {
		const { factory, created } = fakeLane();
		const first = await openDeviceSession(options("dev-lane-2"), { appium: factory });
		const second = await openDeviceSession(options("dev-lane-2"), { appium: factory });
		expect(created[0]?.quitCalls).toBe(1);
		expect(created[1]?.quitCalls).toBe(0);
		expect(second).not.toBe(first);
		await second.quit();
	});

	test("sessions on different devices coexist", async () => {
		const { factory, created } = fakeLane();
		const a = await openDeviceSession(options("dev-lane-3a"), { appium: factory });
		const b = await openDeviceSession(options("dev-lane-3b"), { appium: factory });
		expect(created.map((s) => s.quitCalls)).toEqual([0, 0]);
		await a.quit();
		await b.quit();
	});

	test("a quit session leaves the registry, so the next create does not quit it again", async () => {
		const { factory, created } = fakeLane();
		const first = await openDeviceSession(options("dev-lane-4"), { appium: factory });
		await first.quit();
		expect(created[0]?.quitCalls).toBe(1);
		const second = await openDeviceSession(options("dev-lane-4"), { appium: factory });
		expect(created[0]?.quitCalls).toBe(1);
		await second.quit();
	});

	test("auto-picks Direct when that factory exists and there are no custom capabilities", async () => {
		const { factory: appium, created: appiumCreated } = fakeLane();
		const created: FakeLaneSession[] = [];
		const direct: LaneFactory = async () => {
			const session = {
				lane: "direct",
				stream: null,
				quitCalls: 0,
				quit: async () => {
					session.quitCalls += 1;
				},
			} as unknown as FakeLaneSession;
			created.push(session);
			return session;
		};
		const session = await openDeviceSession(options("dev-lane-auto-direct"), { appium, direct });
		expect(created).toHaveLength(1);
		expect(appiumCreated).toHaveLength(0);
		expect(session.lane).toBe("direct");
		await session.quit();
	});

	test("Direct start failure falls back to Appium and records a warning", async () => {
		const { factory: appium, created } = fakeLane();
		const direct: LaneFactory = async () => {
			throw new Error("idb companion refused");
		};
		const session = await openDeviceSession(
			{ ...options("dev-lane-direct-fail"), requestedLane: "direct" },
			{ appium, direct },
		);
		expect(created).toHaveLength(1);
		expect(session.lane).toBe("appium");
		expect(session.laneWarning).toMatch(/failed to start/);
		await session.quit();
	});

	test("forced Direct with no factory falls back to Appium and records a warning", async () => {
		const { factory, created } = fakeLane();
		const session = await openDeviceSession(
			{ ...options("dev-lane-direct"), requestedLane: "direct" },
			{ appium: factory },
		);
		expect(created).toHaveLength(1);
		expect(session.lane).toBe("appium");
		expect(session.laneWarning).toMatch(/fell back to Appium/);
		await session.quit();
	});

	test("custom capabilities pin Appium even when Direct is requested and available", async () => {
		const { factory: appium, created: appiumCreated } = fakeLane();
		const { factory: direct, created: directCreated } = fakeLane();
		const session = await openDeviceSession(
			{
				...options("dev-lane-pin"),
				requestedLane: "direct",
				appCaps: [{ id: "cap-1", key: "appium:autoLaunch", value: "false" }],
			},
			{ appium, direct },
		);
		expect(directCreated).toHaveLength(0);
		expect(appiumCreated).toHaveLength(1);
		expect(session.lane).toBe("appium");
		expect(session.laneWarning).toMatch(/pin the Appium lane/);
		await session.quit();
	});

	test("a failing Appium factory registers nothing and surfaces the error", async () => {
		const failing: LaneFactory = async () => {
			throw new Error("appium refused");
		};
		await expect(openDeviceSession(options("dev-lane-5"), { appium: failing })).rejects.toThrow(
			"appium refused",
		);
		const { factory, created } = fakeLane();
		const next = await openDeviceSession(options("dev-lane-5"), { appium: factory });
		expect(created).toHaveLength(1);
		await next.quit();
	});

	describe("Direct lane implementations", () => {
		function directImpl(
			name: string,
			opts: { promoted?: boolean; fails?: boolean; warning?: string } = {},
		) {
			const opened: string[] = [];
			return {
				opened,
				impl: {
					name,
					promoted: opts.promoted,
					open: async () => {
						if (opts.fails) throw new Error(`${name} would not start`);
						opened.push(name);
						return {
							lane: "direct",
							stream: null,
							...(opts.warning ? { laneWarning: opts.warning } : {}),
							quit: async () => undefined,
						} as unknown as DeviceSession;
					},
				},
			};
		}

		test("with no new implementation registered, the existing one opens the session", async () => {
			const existing = directImpl("adb", { promoted: true });
			const { factory: appium } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-1"), {
				appium,
				direct: createDirectLane([existing.impl]),
			});
			expect(existing.opened).toEqual(["adb"]);
			expect(session.lane).toBe("direct");
			expect(session.laneWarning).toBeUndefined();
			await session.quit();
		});

		test("a registered new implementation is not used unless opted in", async () => {
			const fresh = directImpl("device-android");
			const existing = directImpl("adb", { promoted: true });
			const { factory: appium } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-2"), {
				appium,
				direct: createDirectLane([fresh.impl, existing.impl]),
			});
			expect(fresh.opened).toEqual([]);
			expect(existing.opened).toEqual(["adb"]);
			await session.quit();
		});

		test("an opted-in new implementation opens the session on the Direct lane", async () => {
			const fresh = directImpl("device-android");
			const existing = directImpl("adb", { promoted: true });
			const { factory: appium } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-3"), {
				appium,
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(fresh.opened).toEqual(["device-android"]);
			expect(existing.opened).toEqual([]);
			expect(session.lane).toBe("direct");
			expect(session.laneWarning).toBeUndefined();
			await session.quit();
		});

		test("a new implementation that fails to start falls back to the existing one, loudly", async () => {
			const fresh = directImpl("device-android", { fails: true });
			const existing = directImpl("adb", { promoted: true });
			const { factory: appium, created } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-4"), {
				appium,
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(existing.opened).toEqual(["adb"]);
			expect(created).toHaveLength(0);
			expect(session.lane).toBe("direct");
			expect(session.laneWarning).toMatch(/device-android failed to start; fell back to adb/);
			await session.quit();
		});

		test("a fallback keeps the warning the implementation it fell back to gave", async () => {
			const fresh = directImpl("device-android", { fails: true });
			const existing = directImpl("adb", { promoted: true, warning: "Android helper unavailable" });
			const { factory: appium } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-warn"), {
				appium,
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(session.laneWarning).toMatch(/device-android failed to start; fell back to adb/);
			expect(session.laneWarning).toMatch(/Android helper unavailable/);
			await session.quit();
		});

		test("when both Direct implementations fail, Appium opens it and both warnings are kept", async () => {
			const fresh = directImpl("device-android", { fails: true });
			const existing = directImpl("adb", { promoted: true, fails: true });
			const { factory: appium, created } = fakeLane();
			const session = await openDeviceSession(options("dev-impl-5"), {
				appium,
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(created).toHaveLength(1);
			expect(session.lane).toBe("appium");
			expect(session.laneWarning).toMatch(/device-android failed to start; fell back to adb/);
			expect(session.laneWarning).toMatch(/Direct lane failed to start; fell back to Appium/);
			await session.quit();
		});
	});

	test("a fallback a Lane reports after open shows on the session the caller holds", async () => {
		let report: ((warning: string) => void) | undefined;
		const direct: LaneFactory = async (opened) => {
			report = opened.onLaneWarning;
			return {
				lane: "direct",
				stream: null,
				quit: async () => undefined,
			} as unknown as DeviceSession;
		};
		const { factory: appium } = fakeLane();
		const seen: string[] = [];
		const session = await openDeviceSession(
			{ ...options("dev-late-warning"), onLaneWarning: (warning) => seen.push(warning) },
			{ appium, direct },
		);
		expect(session.laneWarning).toBeUndefined();

		report?.("yoqa-sim failed mid-session; using idb_companion");
		report?.("second fallback");

		expect(session.laneWarning).toBe(
			"yoqa-sim failed mid-session; using idb_companion; second fallback",
		);
		expect(seen).toEqual(["yoqa-sim failed mid-session; using idb_companion", "second fallback"]);
		await session.quit();
	});
});
