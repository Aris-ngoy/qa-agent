import type { AutoRun } from "@yoqa/runner-client";

/** A Run that has not ended yet: Stop and Esc can still cancel it. */
export function isRunLive(run: AutoRun): boolean {
	return run.status === "queued" || run.status === "running";
}

const ENDED_LABEL: Record<"passed" | "errored" | "cancelled", string> = {
	passed: "Passed",
	errored: "Failed",
	cancelled: "Stopped",
};

/** Where the Run card says the Run is: the step it is on of the draft's, or how it ended. */
export function runCardProgress(run: AutoRun): string {
	if (!isRunLive(run)) return ENDED_LABEL[run.status as keyof typeof ENDED_LABEL];
	if (run.executionMode === "script") return "Replaying the Case Script";
	if (run.status === "queued" || run.currentStep === null) return "Starting…";
	return `Step ${run.currentStep} of ${run.steps.length}`;
}

/** How long the Run has run: from its start until `now`, or until it ended. */
export function runCardElapsedMs(run: AutoRun, now: number): number {
	if (run.startedAt === null) return 0;
	return Math.max(0, (run.finishedAt ?? now) - run.startedAt);
}
