import { formatRunDuration } from "@/features/runs/utils/labels";
import type { CaseHistory, HistoryNote, HistoryRun, HistoryStepResult } from "@yoqa/runner-client";

/** The History tab's three stat tiles. */
export type HistoryStat = { label: string; value: string; failing?: boolean };

export function historyStats(history: CaseHistory): HistoryStat[] {
	const { passed, failed, averagePassMs } = history;
	return [
		{ label: "Pass rate", value: `${passed} / ${passed + failed}` },
		{
			label: "Avg pass",
			value: averagePassMs === null ? "—" : formatRunDuration(averagePassMs),
		},
		{
			label: "Failing",
			value: failed === 0 ? "None" : failed === 1 ? "1 run" : `${failed} runs`,
			failing: failed > 0,
		},
	];
}

export type BarTone = "passed" | "failed" | "running" | "stopped";

/** One bar of the duration chart, as tall as its Run's time against the longest one shown. */
export type DurationBar = {
	runId: string;
	number: number;
	tone: BarTone;
	label: string;
	heightPct: number;
};

/** The shortest bar drawn, so a Run that stopped at once still shows. */
const MIN_BAR_PCT = 6;

function barTone(status: HistoryRun["status"]): BarTone {
	if (status === "passed") return "passed";
	if (status === "errored") return "failed";
	if (status === "cancelled") return "stopped";
	return "running";
}

/**
 * The duration chart's bars, oldest first, scaled to the longest Run that ended. A Run in
 * progress counts its time so far, up to the top: it never shrinks the others.
 */
export function durationBars(runs: HistoryRun[], now: number): DurationBar[] {
	const ended = runs.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs]));
	const longest = Math.max(1, ...ended);
	return [...runs].reverse().map((run) => {
		const ms = run.durationMs ?? (ended.length > 0 ? Math.max(0, now - run.createdAt) : longest);
		return {
			runId: run.runId,
			number: run.number,
			tone: barTone(run.status),
			label: run.durationMs === null ? "…" : formatRunDuration(run.durationMs),
			heightPct: Math.min(100, Math.max(MIN_BAR_PCT, Math.round((ms / longest) * 100))),
		};
	});
}

/** `Run 7 · this chat`, or the title of the chat that started it. */
export function runTitle(run: HistoryRun, chatId: string | null): string {
	if (!run.autoChat) return `Run ${run.number}`;
	return `Run ${run.number} · ${run.autoChat.id === chatId ? "this chat" : run.autoChat.title}`;
}

const UNITS: Array<[label: string, ms: number]> = [
	["mo", 30 * 24 * 60 * 60_000],
	["w", 7 * 24 * 60 * 60_000],
	["d", 24 * 60 * 60_000],
	["h", 60 * 60_000],
	["min", 60_000],
];

/** How long ago, in the largest whole unit: `4 d ago`, `2 w ago`. */
export function timeAgo(at: number, now: number): string {
	const elapsed = Math.max(0, now - at);
	for (const [label, ms] of UNITS) {
		if (elapsed >= ms) return `${Math.floor(elapsed / ms)} ${label} ago`;
	}
	return "just now";
}

const OUTCOME: Record<HistoryRun["status"], string> = {
	queued: "Queued",
	running: "In progress",
	passed: "Passed",
	errored: "Failed",
	cancelled: "Stopped",
};

/** The line under a Run's title: how it went, how long it took and when. */
export function runMeta(run: HistoryRun, now: number): string {
	if (run.status === "running") {
		return run.currentStep ? `In progress · step ${run.currentStep}` : "In progress";
	}
	if (run.status === "queued") return OUTCOME.queued;
	const outcome =
		run.status === "errored" && run.failedStep
			? `Failed at step ${run.failedStep}`
			: OUTCOME[run.status];
	const parts = [outcome];
	if (run.durationMs !== null) parts.push(formatRunDuration(run.durationMs));
	parts.push(timeAgo(run.createdAt, now));
	return parts.join(" · ");
}

function stepRange(from: number, to: number): string {
	if (from === to) return `step ${from}`;
	if (to === from + 1) return `steps ${from} and ${to}`;
	return `steps ${from}–${to}`;
}

/** A per-step strip read out: each run of steps with the same result, in order. */
export function stepStripLabel(steps: HistoryStepResult[]): string {
	if (steps.length === 0) return "No steps";
	if (steps.every((step) => step === "passed")) {
		return steps.length === 1 ? "Step 1 passed" : `All ${steps.length} steps passed`;
	}
	const groups: Array<{ result: HistoryStepResult; from: number; to: number }> = [];
	steps.forEach((result, index) => {
		const last = groups.at(-1);
		if (last?.result === result) last.to = index + 1;
		else groups.push({ result, from: index + 1, to: index + 1 });
	});
	const text = groups
		.map((group) => `${stepRange(group.from, group.to)} ${group.result}`)
		.join(", ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The strip column's header, over the most steps any Run shown ran. */
export function stepsHeader(runs: HistoryRun[]): string {
	const most = Math.max(0, ...runs.map((run) => run.steps.length));
	return most <= 1 ? "Step 1" : `Steps 1–${most}`;
}

/** The History note as the tab shows it: a bold title, then the detail. */
export function historyNoteText(note: HistoryNote, now: number): { title: string; detail: string } {
	if (note.kind === "consistent") {
		const which =
			note.failures === 2 ? "Both failures stop" : `The last ${note.failures} failures all stop`;
		return {
			title: "Consistent failure, not flaky.",
			detail: `${which} at step ${note.step}, starting ${timeAgo(note.since, now)}.`,
		};
	}
	return {
		title: "Flaky.",
		detail: `The last ${note.passed + note.failed} runs mix ${note.passed} passes and ${note.failed} failures, with no change to the steps.`,
	};
}
