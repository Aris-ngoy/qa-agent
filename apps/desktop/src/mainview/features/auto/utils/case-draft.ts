import type { CaseDraft, CaseDraftStep, CaseFlowStep } from "@yoqa/runner-client";

/**
 * One row of the Test tab's Changes view. Step numbers are the draft's, except a removed
 * step's, which is its number in the saved Test Case.
 */
export type DraftChangeRow =
	| { kind: "unchanged"; from: number; to: number }
	| {
			kind: "changed";
			number: number;
			before: CaseFlowStep;
			after: CaseDraftStep;
			reason: string;
	  }
	| { kind: "moved"; number: number; savedNumber: number; after: CaseDraftStep; reason: string }
	| { kind: "added"; number: number; after: CaseDraftStep; reason: string }
	| { kind: "removed"; savedNumber: number; before: CaseFlowStep; reason: string };

/**
 * The Changes view of a Case draft, in the draft's order: changed, moved and added steps with
 * their reasons, stretches of unchanged steps collapsed into one row, and each removed step
 * where it was in the saved case (before the first draft step, not moved, that came after it).
 * The runner gives a step as saved a reason only when it moved out of its saved order.
 */
export function draftChangeRows(draft: CaseDraft): DraftChangeRow[] {
	const savedIndex = new Map(draft.base.map((step, index) => [step.id, index]));
	const removed = draft.removed
		.map((row) => ({ ...row, index: savedIndex.get(row.before.id) ?? draft.base.length }))
		.sort((a, b) => a.index - b.index);
	const rows: DraftChangeRow[] = [];

	const flushRemovedBefore = (index: number) => {
		while (removed[0] && removed[0].index < index) {
			const row = removed.shift() as (typeof removed)[number];
			rows.push({
				kind: "removed",
				savedNumber: row.index + 1,
				before: row.before,
				reason: row.reason,
			});
		}
	};

	draft.steps.forEach((step, at) => {
		const number = at + 1;
		const index = savedIndex.get(step.id);
		const before = index === undefined ? undefined : draft.base[index];
		if (index === undefined || !before) {
			rows.push({ kind: "added", number, after: step, reason: step.reason ?? "" });
			return;
		}
		const asSaved =
			step.instructions === before.instructions && step.expectedResult === before.expectedResult;
		if (asSaved && step.reason) {
			rows.push({
				kind: "moved",
				number,
				savedNumber: index + 1,
				after: step,
				reason: step.reason,
			});
			return;
		}
		flushRemovedBefore(index);
		if (step.reason) {
			rows.push({ kind: "changed", number, before, after: step, reason: step.reason });
			return;
		}
		const last = rows.at(-1);
		if (last?.kind === "unchanged" && last.to === number - 1) last.to = number;
		else rows.push({ kind: "unchanged", from: number, to: number });
	});
	flushRemovedBefore(Number.POSITIVE_INFINITY);
	return rows;
}

export function unchangedLabel(row: { from: number; to: number }): string {
	return row.from === row.to
		? `Step ${row.from} unchanged`
		: `Steps ${row.from}–${row.to} unchanged`;
}

/**
 * Why the Test tab's Apply is off, or null when it is on: Apply needs a Run of the whole draft
 * that passed since the draft last changed. `runLive` is whether a Run of it is going now.
 */
export function applyBlocker(draft: CaseDraft, runLive: boolean): string | null {
	if (draft.passingRunId) return null;
	return runLive
		? "A Run of the draft is in progress: Apply turns on if it passes."
		: "Apply turns on once a Run of the whole draft passes. Ask the chat agent to run it.";
}
