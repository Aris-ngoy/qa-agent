import { describe, expect, test } from "bun:test";
import type { Device, RunTestStatus } from "@yoqa/runner-client";
import { runChip, runTarget, sessionPillLabel, wdaRebuildTarget } from "./session-status";

const SESSION = { deviceId: "dev-1", platform: "ios" as const, connectedAt: 1 };

function runWith(statuses: RunTestStatus[]) {
	return { tests: statuses.map((status) => ({ status })) };
}

describe("sessionPillLabel", () => {
	test("names the Lane next to the live state", () => {
		expect(sessionPillLabel({ streamReady: true, lane: "direct" })).toBe("Live · Direct");
		expect(sessionPillLabel({ lane: "appium" })).toBe("Live · Appium");
		expect(sessionPillLabel({ streamReady: false, lane: "direct" })).toBe("Connected · Direct");
	});

	test("shows the live state alone when the runner does not name the Lane", () => {
		expect(sessionPillLabel({ streamReady: true })).toBe("Live");
	});
});

describe("wdaRebuildTarget", () => {
	const simulator: Device = {
		id: "B75001FB-B91D-4F94-80A7-3E371A641D27",
		name: "iPhone 17 Pro",
		osVersion: "26.0",
		platform: "ios",
		kind: "simulator",
	};
	const onAppium = { ...SESSION, deviceId: simulator.id, lane: "appium" as const };

	test("an iOS Appium-lane session rebuilds on its listed device, with that device's real kind", () => {
		expect(wdaRebuildTarget(onAppium, [simulator])).toMatchObject({
			id: simulator.id,
			kind: "simulator",
		});
	});

	test("offers no rebuild when the device list does not have the device", () => {
		expect(wdaRebuildTarget(onAppium, [])).toBeNull();
		expect(wdaRebuildTarget(onAppium, undefined)).toBeNull();
	});

	test("offers no rebuild off the Appium lane, on Android, or without a session", () => {
		expect(wdaRebuildTarget({ ...onAppium, lane: "direct" }, [simulator])).toBeNull();
		expect(
			wdaRebuildTarget({ ...onAppium, platform: "android" }, [
				{ ...simulator, platform: "android" },
			]),
		).toBeNull();
		expect(wdaRebuildTarget(null, [simulator])).toBeNull();
	});
});

describe("runChip", () => {
	test("shows nothing while no Run holds the session", () => {
		expect(runChip({ ...SESSION, heldByRun: false }, null)).toBeNull();
		expect(runChip(null, null)).toBeNull();
	});

	test("counts the cases the holding Run has started, out of all of them", () => {
		expect(
			runChip(
				{ ...SESSION, heldByRun: true, heldByRunId: "run_a" },
				runWith(["passed", "running", "queued"]),
			),
		).toEqual({ runId: "run_a", label: "Running · 2/3" });
	});

	test("says Running until the holding Run has loaded", () => {
		expect(runChip({ ...SESSION, heldByRun: true, heldByRunId: "run_a" }, null)).toEqual({
			runId: "run_a",
			label: "Running",
		});
	});

	test("says Run in progress, with no Run to link, when the holder is unknown", () => {
		expect(runChip({ ...SESSION, heldByRun: true }, null)).toEqual({
			runId: null,
			label: "Run in progress",
		});
	});
});

describe("runTarget", () => {
	const device = {
		id: "dev-2",
		label: "Pixel",
		name: "Pixel",
		osVersion: "15",
		platform: "android" as const,
		kind: "physical" as const,
	};

	test("runs on the Active Session when there is one", () => {
		expect(runTarget(SESSION, device)).toBe("session");
	});

	test("connects the picked device first when there is no Active Session", () => {
		expect(runTarget(null, device)).toBe("connect-first");
	});

	test("has nothing to run on without a session or a picked device", () => {
		expect(runTarget(null, null)).toBeNull();
	});
});
