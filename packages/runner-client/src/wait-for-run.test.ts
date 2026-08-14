import { describe, expect, test } from "bun:test";
import type { Run } from "./schemas";
import {
	WaitForRunAbortedError,
	WaitForRunTimeoutError,
	pickLatestRun,
	waitForRun,
} from "./wait-for-run";

function sampleRun(overrides: Partial<Run> = {}): Run {
	return {
		id: "run_1",
		appId: "app_1",
		deviceId: "dev_1",
		platform: "ios",
		buildId: null,
		status: "queued",
		executionMode: "script",
		error: null,
		createdAt: 100,
		startedAt: null,
		finishedAt: null,
		tests: [],
		...overrides,
	};
}

describe("waitForRun", () => {
	test("returns immediately when already terminal", async () => {
		const run = sampleRun({ status: "passed" });
		const result = await waitForRun({ getRun: async () => run }, run.id, {
			sleep: async () => undefined,
			now: () => 0,
		});
		expect(result.status).toBe("passed");
	});

	test("polls until the run becomes terminal", async () => {
		const statuses = ["queued", "running", "errored"] as const;
		let index = 0;
		let sleeps = 0;
		const result = await waitForRun(
			{
				getRun: async () => {
					const status = statuses[Math.min(index, statuses.length - 1)] ?? "errored";
					index += 1;
					return sampleRun({ status });
				},
			},
			"run_1",
			{
				timeoutMs: 1_000,
				intervalMs: 5,
				sleep: async () => {
					sleeps += 1;
				},
				now: () => 0,
			},
		);
		expect(result.status).toBe("errored");
		expect(sleeps).toBe(2);
	});

	test("times out while still running", async () => {
		let now = 0;
		const error = await waitForRun(
			{ getRun: async () => sampleRun({ status: "running" }) },
			"run_1",
			{
				timeoutMs: 10,
				intervalMs: 5,
				now: () => now,
				sleep: async (ms) => {
					now += ms;
				},
			},
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(WaitForRunTimeoutError);
		expect((error as WaitForRunTimeoutError).lastRun?.status).toBe("running");
		expect((error as WaitForRunTimeoutError).message).toContain("run_1");
	});

	test("aborts when the signal fires", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			waitForRun({ getRun: async () => sampleRun({ status: "running" }) }, "run_1", {
				signal: controller.signal,
				timeoutMs: 1_000,
				sleep: async () => undefined,
				now: () => 0,
			}),
		).rejects.toBeInstanceOf(WaitForRunAbortedError);
	});
});

describe("pickLatestRun", () => {
	test("returns null for an empty list", () => {
		expect(pickLatestRun([])).toBeNull();
	});

	test("picks the highest createdAt regardless of list order", () => {
		const older = sampleRun({ id: "old", createdAt: 10 });
		const newer = sampleRun({ id: "new", createdAt: 50 });
		expect(pickLatestRun([older, newer])?.id).toBe("new");
		expect(pickLatestRun([newer, older])?.id).toBe("new");
	});
});
