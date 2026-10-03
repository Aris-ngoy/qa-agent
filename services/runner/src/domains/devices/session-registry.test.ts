import { describe, expect, test } from "bun:test";
import type { DeviceSession, LaneFactory, SessionOptions } from "./lane";
import { openDeviceSession } from "./open-session";

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

	test("a failing lane factory registers nothing and surfaces the error", async () => {
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
});
