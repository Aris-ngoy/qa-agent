import type { ActionRequest, ActionResponse, ActionResultScreenshot } from "@yoqa/runner-client";
import { performActionWithScreenshot } from "./action-result";
import { ActionValidationError, performAction } from "./interaction";
import type { DeviceSession } from "./session";

export type BatchRequest = {
	steps: ActionRequest[];
	settleMs?: number;
};

export type BatchResponse = {
	ok: boolean;
	completed: number;
	total: number;
	failedIndex?: number;
	error?: string;
	screenshot?: ActionResultScreenshot;
	steps: ActionResponse[];
};

/** Grounding from a description needs a fresh screen; it is not allowed inside a batch. */
export function assertBatchable(steps: readonly ActionRequest[]): void {
	const bad = steps.findIndex((step) => step.description != null && step.description.trim() !== "");
	if (bad >= 0) {
		throw new ActionValidationError(
			`Batch step ${bad} uses a description; Grounding needs a fresh screen. Use a single Action instead.`,
		);
	}
}

/**
 * Run known Actions in order, then one Settle and one Result screenshot.
 * Stops at the first failed step and returns the frame at that point.
 */
export async function performActionBatch(
	session: DeviceSession,
	request: BatchRequest,
	deps: {
		perform?: typeof performAction;
		performWithScreenshot?: typeof performActionWithScreenshot;
	} = {},
): Promise<BatchResponse> {
	assertBatchable(request.steps);
	const perform = deps.perform ?? performAction;
	const performWithShot = deps.performWithScreenshot ?? performActionWithScreenshot;
	const results: ActionResponse[] = [];

	for (let i = 0; i < request.steps.length; i++) {
		const step = request.steps[i];
		if (!step) continue;
		const isLast = i === request.steps.length - 1;
		try {
			if (isLast) {
				const last = await performWithShot(session, {
					...step,
					screenshot: true,
					settleMs: request.settleMs,
				});
				results.push(last);
				return {
					ok: true,
					completed: results.length,
					total: request.steps.length,
					screenshot: last.screenshot,
					steps: results,
				};
			}
			results.push(await perform(session, step));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const shot = await session.screenshot().catch(() => undefined);
			return {
				ok: false,
				completed: results.length,
				total: request.steps.length,
				failedIndex: i,
				error: message,
				screenshot: shot
					? { path: shot.path, settled: false, waitedMs: 0, changed: null }
					: undefined,
				steps: results,
			};
		}
	}

	return { ok: true, completed: results.length, total: request.steps.length, steps: results };
}
