import type { Run, RunStep } from "@yoqa/runner-client";

/** Every step of the Run in the order it happened. */
export function flattenSteps(run: Run): RunStep[] {
	const rows: RunStep[] = [];
	for (const test of run.tests) {
		for (const step of test.steps ?? []) {
			rows.push(step);
		}
	}
	return rows.sort((a, b) => a.createdAt - b.createdAt || a.idx - b.idx);
}

/** The newest step with a screenshot: what a live Run shows. */
export function latestScreenshotStep(run: Run): RunStep | null {
	let latest: RunStep | null = null;
	for (const step of flattenSteps(run)) {
		if (!step.screenshotUri) continue;
		if (!latest || step.createdAt >= latest.createdAt) {
			latest = step;
		}
	}
	return latest;
}

/** The step a finished Run opens on: its first screenshot, else its first step. */
export function firstReviewStep(run: Run): RunStep | null {
	const steps = flattenSteps(run);
	return steps.find((step) => step.screenshotUri) ?? steps[0] ?? null;
}

/** A name safe to save a file under. */
export function fileSafeName(label: string): string {
	return label.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "video";
}
