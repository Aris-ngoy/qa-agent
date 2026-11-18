import { describe, expect, test } from "bun:test";
import {
	durationBars,
	historyNoteText,
	historyStats,
	runMeta,
	runTitle,
	stepStripLabel,
	stepsHeader,
	timeAgo,
} from "@/features/auto/utils/history";
import type { CaseHistory, HistoryRun } from "@yoqa/runner-client";

const NOW = Date.UTC(2026, 10, 18, 12);
const DAY = 24 * 60 * 60 * 1000;

function run(overrides: Partial<HistoryRun> = {}): HistoryRun {
	return {
		runId: "run_1",
		number: 1,
		status: "passed",
		autoChat: null,
		createdAt: NOW - 4 * DAY,
		durationMs: 32_000,
		currentStep: null,
		failedStep: null,
		steps: ["passed", "passed", "passed"],
		...overrides,
	};
}

function history(overrides: Partial<CaseHistory> = {}): CaseHistory {
	return {
		caseId: "case_1",
		passed: 4,
		failed: 2,
		averagePassMs: 32_400,
		runs: [],
		note: null,
		...overrides,
	};
}

describe("historyStats", () => {
	test("the pass rate over the Runs that ended, the average passing time and the failing count", () => {
		expect(historyStats(history())).toEqual([
			{ label: "Pass rate", value: "4 / 6" },
			{ label: "Avg pass", value: "32s" },
			{ label: "Failing", value: "2 runs", failing: true },
		]);
		expect(historyStats(history({ passed: 0, failed: 1, averagePassMs: null }))).toEqual([
			{ label: "Pass rate", value: "0 / 1" },
			{ label: "Avg pass", value: "—" },
			{ label: "Failing", value: "1 run", failing: true },
		]);
		expect(historyStats(history({ passed: 3, failed: 0 }))[2]).toEqual({
			label: "Failing",
			value: "None",
			failing: false,
		});
	});
});

describe("durationBars", () => {
	test("oldest first, each as tall as its time against the longest, with a Run in progress marked", () => {
		const bars = durationBars(
			[
				run({
					runId: "run_3",
					number: 3,
					status: "running",
					durationMs: null,
					createdAt: NOW - 10_000,
				}),
				run({ runId: "run_2", number: 2, status: "errored", durationMs: 17_000 }),
				run({ runId: "run_1", number: 1, durationMs: 34_000 }),
			],
			NOW,
		);
		expect(bars).toEqual([
			{ runId: "run_1", number: 1, tone: "passed", label: "34s", heightPct: 100 },
			{ runId: "run_2", number: 2, tone: "failed", label: "17s", heightPct: 50 },
			{ runId: "run_3", number: 3, tone: "running", label: "…", heightPct: 29 },
		]);
	});

	test("a Run in progress longer than any that ended stops at the top, and leaves their scale alone", () => {
		const bars = durationBars(
			[
				run({
					runId: "run_2",
					number: 2,
					status: "running",
					durationMs: null,
					createdAt: NOW - 600_000,
				}),
				run({ runId: "run_1", number: 1, durationMs: 30_000 }),
			],
			NOW,
		);
		expect(bars.map((bar) => bar.heightPct)).toEqual([100, 100]);
		const alone = durationBars(
			[run({ status: "running", durationMs: null, createdAt: NOW - 5_000 })],
			NOW,
		);
		expect(alone[0]?.heightPct).toBe(100);
	});

	test("a stopped Run is its own tone, and a bar never shrinks out of sight", () => {
		const bars = durationBars(
			[
				run({ runId: "run_2", number: 2, status: "cancelled", durationMs: 100 }),
				run({ runId: "run_1", number: 1, durationMs: 60_000 }),
			],
			NOW,
		);
		expect(bars[1]).toMatchObject({ tone: "stopped", label: "0s", heightPct: 6 });
	});
});

describe("runTitle and runMeta", () => {
	test("a Run of this chat says so; another chat's Run gives that chat's title", () => {
		const chat = { id: "chat_1", title: "Fix payout" };
		expect(runTitle(run({ number: 7, autoChat: chat }), "chat_1")).toBe("Run 7 · this chat");
		expect(runTitle(run({ number: 7, autoChat: chat }), "chat_2")).toBe("Run 7 · Fix payout");
		expect(runTitle(run({ number: 7 }), "chat_1")).toBe("Run 7");
	});

	test("how each Run went, how long it took and when", () => {
		expect(runMeta(run({ status: "running", durationMs: null, currentStep: 3 }), NOW)).toBe(
			"In progress · step 3",
		);
		expect(runMeta(run({ status: "errored", failedStep: 3, durationMs: 18_000 }), NOW)).toBe(
			"Failed at step 3 · 18s · 4 d ago",
		);
		expect(runMeta(run({ status: "errored", durationMs: 9_000 }), NOW)).toBe(
			"Failed · 9s · 4 d ago",
		);
		expect(runMeta(run({ createdAt: NOW - 15 * DAY }), NOW)).toBe("Passed · 32s · 2 w ago");
		expect(runMeta(run({ status: "cancelled", durationMs: 5_000 }), NOW)).toBe(
			"Stopped · 5s · 4 d ago",
		);
		expect(runMeta(run({ status: "queued", durationMs: null }), NOW)).toBe("Queued");
	});
});

describe("timeAgo", () => {
	test("rounds down to the largest unit", () => {
		expect(timeAgo(NOW - 20_000, NOW)).toBe("just now");
		expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
		expect(timeAgo(NOW - 3 * 60 * 60_000, NOW)).toBe("3 h ago");
		expect(timeAgo(NOW - 6 * DAY, NOW)).toBe("6 d ago");
		expect(timeAgo(NOW - 20 * DAY, NOW)).toBe("2 w ago");
		expect(timeAgo(NOW - 70 * DAY, NOW)).toBe("2 mo ago");
	});
});

describe("stepStripLabel and stepsHeader", () => {
	test("names each run of steps with the same result", () => {
		expect(stepStripLabel(["passed", "passed", "passed", "passed", "passed"])).toBe(
			"All 5 steps passed",
		);
		expect(stepStripLabel(["passed", "passed", "failed", "skipped", "skipped"])).toBe(
			"Steps 1 and 2 passed, step 3 failed, steps 4 and 5 skipped",
		);
		expect(stepStripLabel(["passed", "passed", "passed", "running", "pending"])).toBe(
			"Steps 1–3 passed, step 4 running, step 5 pending",
		);
		expect(stepStripLabel([])).toBe("No steps");
	});

	test("the strip header covers the most steps any Run ran", () => {
		expect(
			stepsHeader([run({ steps: ["passed"] }), run({ steps: ["passed", "failed", "skipped"] })]),
		).toBe("Steps 1–3");
		expect(stepsHeader([run({ steps: ["passed"] })])).toBe("Step 1");
	});
});

describe("historyNoteText", () => {
	test("a consistent failure names its step and when it started", () => {
		expect(
			historyNoteText({ kind: "consistent", step: 3, failures: 2, since: NOW - 6 * DAY }, NOW),
		).toEqual({
			title: "Consistent failure, not flaky.",
			detail: "Both failures stop at step 3, starting 6 d ago.",
		});
		expect(
			historyNoteText({ kind: "consistent", step: 1, failures: 3, since: NOW - 60_000 }, NOW)
				.detail,
		).toBe("The last 3 failures all stop at step 1, starting 1 min ago.");
	});

	test("flaky says the steps did not change", () => {
		expect(historyNoteText({ kind: "flaky", passed: 3, failed: 2 }, NOW)).toEqual({
			title: "Flaky.",
			detail: "The last 5 runs mix 3 passes and 2 failures, with no change to the steps.",
		});
	});
});
