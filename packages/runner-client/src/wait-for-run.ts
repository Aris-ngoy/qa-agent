import type { Run, RunStatus } from "./schemas";

export const DEFAULT_WAIT_FOR_RUN_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_WAIT_FOR_RUN_INTERVAL_MS = 2000;

export type TerminalRunStatus = "passed" | "errored" | "cancelled";

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
	return status === "passed" || status === "errored" || status === "cancelled";
}

export type WaitForRunClient = {
	getRun: (runId: string) => Promise<Run>;
};

export type WaitForRunOptions = {
	timeoutMs?: number;
	intervalMs?: number;
	signal?: AbortSignal;
	onStatus?: (run: Run) => void;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

export class WaitForRunTimeoutError extends Error {
	readonly runId: string;
	readonly lastRun: Run | null;
	readonly timeoutMs: number;

	constructor(runId: string, timeoutMs: number, lastRun: Run | null) {
		const lastStatus = lastRun?.status ?? "unknown";
		super(`Timed out after ${timeoutMs}ms waiting for run ${runId} (last status: ${lastStatus})`);
		this.name = "WaitForRunTimeoutError";
		this.runId = runId;
		this.lastRun = lastRun;
		this.timeoutMs = timeoutMs;
	}
}

export class WaitForRunAbortedError extends Error {
	readonly runId: string;
	readonly lastRun: Run | null;

	constructor(runId: string, lastRun: Run | null) {
		super(`Wait for run ${runId} was aborted`);
		this.name = "WaitForRunAbortedError";
		this.runId = runId;
		this.lastRun = lastRun;
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `getRun` until the catalog run reaches passed / errored / cancelled.
 */
export async function waitForRun(
	client: WaitForRunClient,
	runId: string,
	options: WaitForRunOptions = {},
): Promise<Run> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_FOR_RUN_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? DEFAULT_WAIT_FOR_RUN_INTERVAL_MS;
	if (!(timeoutMs > 0)) {
		throw new Error("timeoutMs must be positive");
	}
	if (intervalMs < 0) {
		throw new Error("intervalMs must be non-negative");
	}

	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const deadline = now() + timeoutMs;
	let lastRun: Run | null = null;

	while (now() < deadline) {
		if (options.signal?.aborted) {
			throw new WaitForRunAbortedError(runId, lastRun);
		}

		lastRun = await client.getRun(runId);
		options.onStatus?.(lastRun);
		if (isTerminalRunStatus(lastRun.status)) {
			return lastRun;
		}

		const remaining = deadline - now();
		if (remaining <= 0) break;
		await sleep(Math.min(intervalMs, remaining));
	}

	if (options.signal?.aborted) {
		throw new WaitForRunAbortedError(runId, lastRun);
	}
	if (lastRun && isTerminalRunStatus(lastRun.status)) {
		return lastRun;
	}
	throw new WaitForRunTimeoutError(runId, timeoutMs, lastRun);
}

export function pickLatestRun<T extends { createdAt: number }>(runs: T[]): T | null {
	if (runs.length === 0) return null;
	return runs.reduce((best, run) => (run.createdAt > best.createdAt ? run : best));
}
