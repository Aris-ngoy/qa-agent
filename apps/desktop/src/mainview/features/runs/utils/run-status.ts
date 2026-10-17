import type { RunStatus } from "@yoqa/runner-client";

const LIVE_STATUSES = new Set<RunStatus>(["queued", "running"]);
const TERMINAL_STATUSES = new Set<RunStatus>(["passed", "errored", "cancelled"]);

/** Queued or running: the Run still moves, so its views poll. */
export function isLiveRunStatus(status: RunStatus): boolean {
	return LIVE_STATUSES.has(status);
}

/** Passed, errored or cancelled: the Run is done and its report can be exported. */
export function isTerminalRunStatus(status: RunStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}
