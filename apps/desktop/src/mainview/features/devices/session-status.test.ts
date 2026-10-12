import { describe, expect, test } from "bun:test";
import type { RunTestStatus } from "@yoqa/runner-client";
import { connectedToastMessage, hasRunTarget, runChip, sessionPillLabel } from "./session-status";

const SESSION = { deviceId: "dev-1", platform: "ios" as const, connectedAt: 1 };

function runWith(statuses: RunTestStatus[]) {
	return { tests: statuses.map((status) => ({ status })) };
}

describe("sessionPillLabel", () => {
	test("names the Lane next to the live state", () => {
		expect(sessionPillLabel({ streamReady: true, lane: "direct" })).toBe("Live · Direct");
		expect(sessionPillLabel({ lane: "direct" })).toBe("Live · Direct");
		expect(sessionPillLabel({ streamReady: false, lane: "direct" })).toBe("Connected · Direct");
	});

	test("shows the live state alone when the runner does not name the Lane", () => {
		expect(sessionPillLabel({ streamReady: true })).toBe("Live");
	});
});

describe("connectedToastMessage", () => {
	test("a Lane without a stream is a plain Screenshot Poll, not a failure", () => {
		expect(connectedToastMessage({ streamState: "none", streamReady: false })).toBe(
			"Connected — screenshot poll",
		);
	});

	test("only a stream that failed says it is unavailable", () => {
		expect(connectedToastMessage({ streamState: "failed", streamReady: false })).toBe(
			"Connected — screenshot poll (live stream unavailable)",
		);
		expect(connectedToastMessage({ streamState: "ready", streamReady: true })).toBe(
			"Connected — live stream on",
		);
	});

	test("an older runner without streamState keeps the old reading of streamReady", () => {
		expect(connectedToastMessage({ streamReady: false })).toBe(
			"Connected — screenshot poll (live stream unavailable)",
		);
		expect(connectedToastMessage({})).toBe("Connected — live stream on");
	});
});

describe("runChip", () => {
	test("shows nothing while no Run holds the session", () => {
		expect(runChip({ ...SESSION, heldByRun: false }, null)).toBeNull();
		expect(runChip(null, null)).toBeNull();
	});

	test("counts the cases the holding Run has finished, as the runs list does, out of all of them", () => {
		expect(
			runChip(
				{ ...SESSION, heldByRun: true, heldByRunId: "run_a" },
				runWith(["passed", "errored", "cancelled", "running", "queued"]),
			),
		).toEqual({ runId: "run_a", label: "Running · 3/5", finished: 3, total: 5 });
		expect(
			runChip(
				{ ...SESSION, heldByRun: true, heldByRunId: "run_a" },
				runWith(["running", "queued"]),
			),
		).toEqual({ runId: "run_a", label: "Running · 0/2", finished: 0, total: 2 });
	});

	test("says Running until the holding Run has loaded", () => {
		expect(runChip({ ...SESSION, heldByRun: true, heldByRunId: "run_a" }, null)).toEqual({
			runId: "run_a",
			label: "Running",
			finished: 0,
			total: 0,
		});
	});

	test("says Run in progress, with no Run to link, when the holder is unknown", () => {
		expect(runChip({ ...SESSION, heldByRun: true }, null)).toEqual({
			runId: null,
			label: "Run in progress",
			finished: 0,
			total: 0,
		});
	});
});

describe("hasRunTarget", () => {
	const device = {
		id: "dev-2",
		label: "Pixel",
		name: "Pixel",
		osVersion: "15",
		platform: "android" as const,
		kind: "physical" as const,
	};

	test("runs on the Active Session when there is one", () => {
		expect(hasRunTarget(SESSION, device)).toBe(true);
		expect(hasRunTarget(SESSION, null)).toBe(true);
	});

	test("runs on the picked device, connected first, when there is no Active Session", () => {
		expect(hasRunTarget(null, device)).toBe(true);
	});

	test("has nothing to run on without a session or a picked device", () => {
		expect(hasRunTarget(null, null)).toBe(false);
	});
});
