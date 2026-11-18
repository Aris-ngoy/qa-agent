import { describe, expect, test } from "bun:test";
import { isRunLive, runCardElapsedMs, runCardProgress } from "@/features/auto/utils/run-card";
import type { AutoRun, AutoRunStep } from "@yoqa/runner-client";

function step(status: AutoRunStep["status"]): AutoRunStep {
	return { instructions: "Tap", expectedResult: "", status, commands: [] };
}

function run(overrides: Partial<AutoRun> = {}): AutoRun {
	return {
		runId: "run_1",
		caseId: "case_1",
		status: "running",
		executionMode: "agent",
		provider: null,
		createdAt: 1_000,
		startedAt: 2_000,
		finishedAt: null,
		currentStep: 3,
		currentCommand: null,
		steps: [step("passed"), step("passed"), step("running"), step("pending"), step("pending")],
		replayed: [],
		error: null,
		...overrides,
	};
}

describe("runCardProgress", () => {
	test("an agent Run in progress is on step n of the draft's steps", () => {
		expect(runCardProgress(run())).toBe("Step 3 of 5");
	});

	test("before it reaches a step it is starting, and a replay says so", () => {
		expect(runCardProgress(run({ status: "queued", currentStep: null }))).toBe("Starting…");
		expect(runCardProgress(run({ executionMode: "script", currentStep: null }))).toBe(
			"Replaying the Case Script",
		);
	});

	test("once it ends, how it ended", () => {
		expect(runCardProgress(run({ status: "passed", currentStep: null }))).toBe("Passed");
		expect(runCardProgress(run({ status: "errored", currentStep: null }))).toBe("Failed");
		expect(runCardProgress(run({ status: "cancelled", currentStep: null }))).toBe("Stopped");
	});
});

describe("runCardElapsedMs", () => {
	test("counts from the start until now while the Run is live", () => {
		expect(runCardElapsedMs(run(), 14_500)).toBe(12_500);
	});

	test("stops at the end, and is zero before it starts", () => {
		expect(runCardElapsedMs(run({ status: "passed", finishedAt: 9_000 }), 99_000)).toBe(7_000);
		expect(runCardElapsedMs(run({ status: "queued", startedAt: null }), 5_000)).toBe(0);
	});
});

describe("isRunLive", () => {
	test("queued and running Runs are live; ended ones are not", () => {
		expect([
			isRunLive(run({ status: "queued" })),
			isRunLive(run()),
			isRunLive(run({ status: "passed" })),
			isRunLive(run({ status: "errored" })),
			isRunLive(run({ status: "cancelled" })),
		]).toEqual([true, true, false, false, false]);
	});
});
