import { describe, expect, test } from "bun:test";
import type { RunTestStatus } from "@yoqa/runner-client";
import { offersWdaRebuild, runChip, runTarget, sessionPillLabel } from "./session-status";

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

describe("offersWdaRebuild", () => {
	test("only an iOS session on the Appium lane runs WebDriverAgent", () => {
		expect(offersWdaRebuild({ platform: "ios", lane: "appium" })).toBe(true);
		expect(offersWdaRebuild({ platform: "ios", lane: "direct" })).toBe(false);
		expect(offersWdaRebuild({ platform: "android", lane: "appium" })).toBe(false);
		expect(offersWdaRebuild(null)).toBe(false);
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
