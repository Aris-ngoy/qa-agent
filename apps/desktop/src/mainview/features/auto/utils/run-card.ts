import type { AutoRun, AutoRunControl } from "@yoqa/runner-client";

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

/** The Run card's buttons: Pause and Take over while the Run goes on, Resume once it pauses. */
export function runCardControls(run: AutoRun): AutoRunControl[] {
	if (!isRunLive(run)) return [];
	if (run.pause === null) return ["pause", "take-over"];
	if (run.pause === "taken_over") return ["resume"];
	return ["resume", "take-over"];
}

const PAUSE_NOTE: Record<NonNullable<AutoRun["pause"]>, string> = {
	pausing: "Pausing once the Action in flight settles…",
	paused: "Paused. Resume carries on from here.",
	taken_over:
		"You have the device: drive it in the Device tab. What you do by hand is not recorded, and a Run taken over does not count for Apply.",
};

/** Where the Run is with Pause and Take over; null while it goes on. */
export function runCardPauseNote(run: AutoRun): string | null {
	return isRunLive(run) && run.pause ? PAUSE_NOTE[run.pause] : null;
}
