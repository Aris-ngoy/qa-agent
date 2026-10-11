import { describe, expect, test } from "bun:test";
import type { Device, Run, RunTest } from "@yoqa/runner-client";
import {
	filterRuns,
	formatRunContextCaption,
	formatRunDetailMeta,
	formatRunDeviceLines,
	formatRunDuration,
	formatRunListDate,
	runListResult,
} from "./labels";

function testRow(status: RunTest["status"], id = "t1"): RunTest {
	return {
		id,
		runId: "run-1",
		caseId: "case-1",
		status,
		error: null,
		startedAt: null,
		finishedAt: null,
	};
}

function run(overrides: Partial<Run> & Pick<Run, "status" | "tests">): Run {
	return {
		id: "run-1",
		appId: "app",
		deviceId: "00008120-000E6D1234567890",
		platform: "ios",
		buildId: null,
		executionMode: "auto",
		error: null,
		createdAt: 0,
		startedAt: null,
		finishedAt: null,
		...overrides,
	};
}

const iphone: Device = {
	id: "00008120-000E6D1234567890",
	name: "iPhone 15",
	osVersion: "27.0.1",
	platform: "ios",
	kind: "physical",
	model: "iPhone15,4",
};

describe("runListResult", () => {
	test("a passed run shows how many cases passed, in the passed tone", () => {
		expect(runListResult(run({ status: "passed", tests: [testRow("passed")] }))).toEqual({
			tone: "passed",
			chip: "1 / 1",
			label: "Passed",
		});
	});

	test("a failed run shows the passed fraction in the failed tone", () => {
		expect(runListResult(run({ status: "errored", tests: [testRow("errored")] }))).toEqual({
			tone: "failed",
			chip: "0 / 1",
			label: "Failed",
		});
	});

	test("a run with no cases is empty, whatever its status", () => {
		expect(runListResult(run({ status: "passed", tests: [] }))).toEqual({
			tone: "empty",
			chip: "—",
			label: "No tests",
		});
	});

	test("a live run keeps the fraction and says it is still running", () => {
		expect(
			runListResult(
				run({ status: "running", tests: [testRow("passed", "a"), testRow("running", "b")] }),
			),
		).toEqual({
			tone: "live",
			chip: "1 / 2",
			label: "Running",
		});
		expect(runListResult(run({ status: "queued", tests: [testRow("queued")] })).label).toBe(
			"Queued",
		);
	});

	test("a cancelled run keeps the fraction and says it was cancelled", () => {
		expect(runListResult(run({ status: "cancelled", tests: [testRow("cancelled")] }))).toEqual({
			tone: "cancelled",
			chip: "0 / 1",
			label: "Cancelled",
		});
	});
});

describe("filterRuns", () => {
	const passed = run({ id: "p", status: "passed", tests: [testRow("passed")] });
	const failed = run({ id: "f", status: "errored", tests: [testRow("errored")] });
	const empty = run({ id: "e", status: "passed", tests: [] });
	const live = run({ id: "l", status: "running", tests: [testRow("running")] });
	const rows = [passed, failed, empty, live];

	test("all keeps every run", () => {
		expect(filterRuns(rows, "all")).toEqual(rows);
	});

	test("passed keeps runs that passed with cases, not empty or live ones", () => {
		expect(filterRuns(rows, "passed").map((row) => row.id)).toEqual(["p"]);
	});

	test("failed keeps only errored runs", () => {
		expect(filterRuns(rows, "failed").map((row) => row.id)).toEqual(["f"]);
	});
});

describe("formatRunListDate", () => {
	test("formats like the runs list: short month, day, and 12-hour time", () => {
		expect(formatRunListDate(Date.UTC(2026, 9, 10, 23, 38), "en-US", "UTC")).toBe(
			"Oct 10, 11:38 PM",
		);
	});
});

describe("formatRunDeviceLines", () => {
	test("names the device and OS, then the model and a shortened id", () => {
		expect(formatRunDeviceLines(iphone, { deviceId: iphone.id, platform: "ios" })).toEqual({
			title: "iPhone 15 · iOS 27.0.1",
			meta: "iPhone15,4 · 00008120-000E6D…",
		});
	});

	test("without a listed device, shows the shortened id and the platform", () => {
		expect(
			formatRunDeviceLines(undefined, {
				deviceId: "emulator-5554",
				platform: "android",
			}),
		).toEqual({
			title: "emulator-5554",
			meta: "Android",
		});
	});
});

describe("formatRunDuration", () => {
	test("reads a short run in seconds, as on the run details artboard", () => {
		expect(formatRunDuration(38_000)).toBe("38s");
	});

	test("keeps leftover seconds once a run passes a minute", () => {
		expect(formatRunDuration(90_000)).toBe("1m 30s");
	});

	test("keeps hours when a run runs that long", () => {
		expect(formatRunDuration(7_500_000)).toBe("2h 5m");
	});
});

describe("formatRunDetailMeta", () => {
	const at = Date.UTC(2026, 9, 10, 23, 38);

	test("lines up model, OS, the full device id, the date, the steps, and the duration", () => {
		expect(
			formatRunDetailMeta({
				device: iphone,
				fallback: { deviceId: iphone.id, platform: "ios" },
				at,
				stepCount: 4,
				durationMs: 38_000,
				locale: "en-US",
				timeZone: "UTC",
			}),
		).toBe(
			"iPhone15,4 · iOS 27.0.1 · 00008120-000E6D1234567890 · Oct 10, 11:38 PM · 4 steps · 38s",
		);
	});

	test("says step, not steps, when the run recorded one", () => {
		expect(
			formatRunDetailMeta({
				device: iphone,
				fallback: { deviceId: iphone.id, platform: "ios" },
				at,
				stepCount: 1,
				durationMs: null,
				locale: "en-US",
				timeZone: "UTC",
			}),
		).toBe("iPhone15,4 · iOS 27.0.1 · 00008120-000E6D1234567890 · Oct 10, 11:38 PM · 1 step");
	});

	test("without a listed device, names the platform and the full id", () => {
		expect(
			formatRunDetailMeta({
				device: undefined,
				fallback: { deviceId: "emulator-5554", platform: "android" },
				at,
				stepCount: 0,
				durationMs: null,
				locale: "en-US",
				timeZone: "UTC",
			}),
		).toBe("Android · emulator-5554 · Oct 10, 11:38 PM · 0 steps");
	});
});

describe("formatRunContextCaption", () => {
	test("names today and the connected device", () => {
		expect(formatRunContextCaption(iphone)).toBe("Today · iPhone 15 · iOS 27.0.1");
	});

	test("is absent when no device is connected", () => {
		expect(formatRunContextCaption(undefined)).toBeNull();
	});
});
