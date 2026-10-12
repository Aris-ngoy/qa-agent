import { describe, expect, test } from "bun:test";
import { createDirectLane } from "./direct-lane";
import {
	type DeviceSession,
	type LaneFactory,
	type SessionOptions,
	reportLaneFallback,
} from "./lane";
import { defaultLanesFor, openDeviceSession } from "./open-session";

function options(deviceId: string): SessionOptions {
	return { platform: "android", deviceId };
}

type FakeLaneSession = DeviceSession & { quitCalls: number };

function fakeLane(): {
	factory: LaneFactory;
	created: FakeLaneSession[];
} {
	const created: FakeLaneSession[] = [];
	const factory: LaneFactory = async () => {
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
	return { factory, created };
}

describe("openDeviceSession (lane dispatcher)", () => {
	test("Android and iOS defaults include Direct", () => {
		expect(defaultLanesFor("android").direct).toBeTruthy();
		expect(defaultLanesFor("ios").direct).toBeTruthy();
	});

	test("creates the session through the Direct lane factory", async () => {
		const { factory, created } = fakeLane();
		const session = await openDeviceSession(options("dev-lane-1"), { direct: factory });
		expect(created).toHaveLength(1);
		expect(session.lane).toBe("direct");
		await session.quit();
	});

	test("a second session for the same device quits the first (one Device Session per device)", async () => {
		const { factory, created } = fakeLane();
		const first = await openDeviceSession(options("dev-lane-2"), { direct: factory });
		const second = await openDeviceSession(options("dev-lane-2"), { direct: factory });
		expect(created[0]?.quitCalls).toBe(1);
		expect(created[1]?.quitCalls).toBe(0);
		expect(second).not.toBe(first);
		await second.quit();
	});

	test("sessions on different devices coexist", async () => {
		const { factory, created } = fakeLane();
		const a = await openDeviceSession(options("dev-lane-3a"), { direct: factory });
		const b = await openDeviceSession(options("dev-lane-3b"), { direct: factory });
		expect(created.map((s) => s.quitCalls)).toEqual([0, 0]);
		await a.quit();
		await b.quit();
	});

	test("a quit session leaves the registry, so the next create does not quit it again", async () => {
		const { factory, created } = fakeLane();
		const first = await openDeviceSession(options("dev-lane-4"), { direct: factory });
		await first.quit();
		expect(created[0]?.quitCalls).toBe(1);
		const second = await openDeviceSession(options("dev-lane-4"), { direct: factory });
		expect(created[0]?.quitCalls).toBe(1);
		await second.quit();
	});

	test("a failed Direct start fails the connect and opens nothing else", async () => {
		const direct: LaneFactory = async () => {
			throw new Error("idb companion refused");
		};
		await expect(
			openDeviceSession(
				{ ...options("dev-lane-direct-fail"), requestedLane: "direct" },
				{ direct },
			),
		).rejects.toThrow("idb companion refused");
	});

	test("a failing Direct factory registers nothing and surfaces the error", async () => {
		const failing: LaneFactory = async () => {
			throw new Error("direct refused");
		};
		await expect(openDeviceSession(options("dev-lane-5"), { direct: failing })).rejects.toThrow(
			"direct refused",
		);
		const { factory, created } = fakeLane();
		const next = await openDeviceSession(options("dev-lane-5"), { direct: factory });
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
			const session = await openDeviceSession(options("dev-impl-1"), {
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
			const session = await openDeviceSession(options("dev-impl-2"), {
				direct: createDirectLane([fresh.impl, existing.impl]),
			});
			expect(fresh.opened).toEqual([]);
			expect(existing.opened).toEqual(["adb"]);
			await session.quit();
		});

		test("an opted-in new implementation opens the session on the Direct lane", async () => {
			const fresh = directImpl("device-android");
			const existing = directImpl("adb", { promoted: true });
			const session = await openDeviceSession(options("dev-impl-3"), {
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
			const session = await openDeviceSession(options("dev-impl-4"), {
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(existing.opened).toEqual(["adb"]);
			expect(session.lane).toBe("direct");
			expect(session.laneWarning).toMatch(/device-android failed to start; fell back to adb/);
			await session.quit();
		});

		test("a fallback keeps the warning the implementation it fell back to gave", async () => {
			const fresh = directImpl("device-android", { fails: true });
			const existing = directImpl("adb", { promoted: true, warning: "Android helper unavailable" });
			const session = await openDeviceSession(options("dev-impl-warn"), {
				direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
			});
			expect(session.laneWarning).toMatch(/device-android failed to start; fell back to adb/);
			expect(session.laneWarning).toMatch(/Android helper unavailable/);
			await session.quit();
		});

		test("when both Direct implementations fail, the connect fails", async () => {
			const fresh = directImpl("device-android", { fails: true });
			const existing = directImpl("adb", { promoted: true, fails: true });
			await expect(
				openDeviceSession(options("dev-impl-5"), {
					direct: createDirectLane([fresh.impl, existing.impl], "device-android"),
				}),
			).rejects.toThrow("adb would not start");
		});
	});

	test("a fallback a Lane reports while it opens keeps that Lane and shows once", async () => {
		const direct: LaneFactory = async (opened) => {
			const lane = {
				lane: "direct",
				stream: null,
				quit: async () => undefined,
			} as unknown as DeviceSession;
			// yoqa-sim failing at connect: the Lane carries on with idb_companion.
			reportLaneFallback(lane, opened, "yoqa-sim failed; using idb_companion");
			return lane;
		};
		const session = await openDeviceSession(options("dev-early-warning"), { direct });
		expect(session.lane).toBe("direct");
		expect(session.laneWarning).toBe("yoqa-sim failed; using idb_companion");
		await session.quit();
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
		const seen: string[] = [];
		const session = await openDeviceSession(
			{ ...options("dev-late-warning"), onLaneWarning: (warning) => seen.push(warning) },
			{ direct },
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

describe("openDeviceSession on a cabled physical iPhone", () => {
	const PHONE = "00008120-000E6D813E2A601E";
	const phone = (requestedLane: SessionOptions["requestedLane"]): SessionOptions => ({
		platform: "ios",
		deviceId: PHONE,
		requestedLane,
	});
	function directLane(fail?: string) {
		const opened: string[] = [];
		const factory: LaneFactory = async (opts) => {
			opened.push(opts.deviceId);
			if (fail) throw new Error(fail);
			return {
				lane: "direct",
				stream: null,
				quit: async () => undefined,
			} as unknown as DeviceSession;
		};
		return { factory, opened };
	}

	test("auto opens the Direct lane", async () => {
		const direct = directLane();
		const session = await openDeviceSession(phone("auto"), { direct: direct.factory });
		expect(session.lane).toBe("direct");
		expect(session.laneWarning).toBeUndefined();
		expect(direct.opened).toEqual([PHONE]);
		await session.quit();
	});

	test("auto fails the connect when the runner can't start", async () => {
		const direct = directLane("YoqaRunner status did not cross the cable to port 8100");
		await expect(openDeviceSession(phone("auto"), { direct: direct.factory })).rejects.toThrow(
			"YoqaRunner status did not cross the cable to port 8100",
		);
	});

	test("an explicit direct request opens the Direct lane", async () => {
		const direct = directLane();
		const session = await openDeviceSession(phone("direct"), { direct: direct.factory });
		expect(session.lane).toBe("direct");
		expect(direct.opened).toEqual([PHONE]);
		await session.quit();
	});

	test("a direct request whose status fails opens nothing else", async () => {
		const direct = directLane("YoqaRunner status did not cross the cable to port 8100");
		await expect(openDeviceSession(phone("direct"), { direct: direct.factory })).rejects.toThrow(
			"YoqaRunner status did not cross the cable to port 8100",
		);
	});
});
