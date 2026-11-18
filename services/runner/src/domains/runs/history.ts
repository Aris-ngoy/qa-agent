import type {
	CaseHistory,
	HistoryNote,
	HistoryRun,
	HistoryStepResult,
	RunTest,
} from "@yoqa/runner-client";
import { getCase } from "../catalog/application";
import { type CaseRun, latestCaseRuns } from "./application";
import { RunNotFoundError } from "./errors";
import { type RanStep, reachedStep } from "./step-progress";

/**
 * A Test Case's History summary: its recent Runs, how healthy they are, and one note from a
 * fixed rule (no model call), so it is instant and always the same.
 */

/** How many of the case's latest Runs the History covers. */
const RECENT_RUNS = 20;
/** How many Runs that ended the flaky rule looks at. */
const FLAKY_WINDOW = 5;

/** Each step's result in the case's part of one Run, and where it stopped or is. */
function stepResults(
	test: RunTest,
	steps: RanStep[],
): Pick<HistoryRun, "steps" | "currentStep" | "failedStep"> {
	const all = (result: HistoryStepResult) => steps.map(() => result);
	if (test.status === "passed")
		return { steps: all("passed"), currentStep: null, failedStep: null };
	// A replayed Case Script does not say which step it is on, and a queued case has none.
	if (test.executionMode !== "agent" || test.status === "queued") {
		const pending = test.status === "running" || test.status === "queued";
		return { steps: all(pending ? "pending" : "skipped"), currentStep: null, failedStep: null };
	}
	const runSteps = test.steps ?? [];
	const running = test.status === "running";
	// It ended before its first step (the App would not start, say): no step failed.
	if (runSteps.length === 0 && !running) {
		return { steps: all("skipped"), currentStep: null, failedStep: null };
	}
	const reached = reachedStep(runSteps, steps);
	const atReached: HistoryStepResult = running
		? "running"
		: test.status === "errored"
			? "failed"
			: "skipped";
	return {
		steps: steps.map((_, index) =>
			index < reached ? "passed" : index === reached ? atReached : running ? "pending" : "skipped",
		),
		currentStep: running ? reached + 1 : null,
		failedStep: test.status === "errored" ? reached + 1 : null,
	};
}

/** One Run as the History shows it; `savedSteps` stand in for the steps of a Run that kept none. */
function historyRun(caseRun: CaseRun, number: number, savedSteps: RanStep[]): HistoryRun {
	const { run, test } = caseRun;
	const ended = test.status !== "running" && test.status !== "queued";
	return {
		runId: run.id,
		number,
		status: test.status,
		autoChat: run.autoChat ?? null,
		createdAt: run.createdAt,
		durationMs:
			ended && test.startedAt !== null && test.finishedAt !== null
				? test.finishedAt - test.startedAt
				: null,
		...stepResults(test, caseRun.ranSteps ?? savedSteps),
	};
}

/** The same steps, in the same order, word for word. */
function sameSteps(a: CaseRun["ranSteps"], b: CaseRun["ranSteps"]): boolean {
	return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether two failed Runs stopped at the same step: the same number, and the same text
 * where both Runs kept their steps (step 3 of an older draft may be another step).
 */
function sameFailedStep(a: { caseRun: CaseRun; run: HistoryRun }, b: typeof a): boolean {
	const step = a.run.failedStep;
	if (step === null || b.run.status !== "errored" || b.run.failedStep !== step) return false;
	const textA = a.caseRun.ranSteps?.[step - 1];
	const textB = b.caseRun.ranSteps?.[step - 1];
	return !textA || !textB || JSON.stringify(textA) === JSON.stringify(textB);
}

/**
 * The note: consistent when the last two or more Runs that ended failed at the same step;
 * else flaky when the last five that ended mix passes and failures and ran the same steps.
 */
function historyNote(ended: Array<{ caseRun: CaseRun; run: HistoryRun }>): HistoryNote | null {
	const [latest] = ended;
	if (latest?.run.status === "errored" && latest.run.failedStep !== null) {
		let streak = 1;
		for (const item of ended.slice(1)) {
			if (!sameFailedStep(latest, item)) break;
			streak += 1;
		}
		const first = ended[streak - 1];
		if (streak >= 2 && first) {
			const step = latest.run.failedStep;
			return { kind: "consistent", step, failures: streak, since: first.run.createdAt };
		}
	}
	const window = ended.slice(0, FLAKY_WINDOW);
	if (window.length < FLAKY_WINDOW) return null;
	const passed = window.filter((item) => item.run.status === "passed").length;
	const failed = window.length - passed;
	const steps = window[0]?.caseRun.ranSteps ?? null;
	const unchanged = window.every((item) => sameSteps(item.caseRun.ranSteps, steps));
	return passed > 0 && failed > 0 && unchanged ? { kind: "flaky", passed, failed } : null;
}

/** The History summary of Test Case `caseId`, over its latest Runs. */
export async function caseHistory(caseId: string): Promise<CaseHistory> {
	const catalogCase = await getCase(caseId);
	if (!catalogCase) throw new RunNotFoundError("Case not found");
	const { total, latest } = await latestCaseRuns(caseId, RECENT_RUNS);
	const items = latest.map((caseRun, index) => ({
		caseRun,
		run: historyRun(caseRun, total - index, catalogCase.flows),
	}));
	const ended = items.filter(
		(item) => item.run.status === "passed" || item.run.status === "errored",
	);
	const passing = ended.flatMap((item) =>
		item.run.status === "passed" && item.run.durationMs !== null ? [item.run.durationMs] : [],
	);
	const passed = ended.filter((item) => item.run.status === "passed").length;
	return {
		caseId,
		passed,
		failed: ended.length - passed,
		averagePassMs:
			passing.length > 0
				? Math.round(passing.reduce((sum, ms) => sum + ms, 0) / passing.length)
				: null,
		runs: items.map((item) => item.run),
		note: historyNote(ended),
	};
}
