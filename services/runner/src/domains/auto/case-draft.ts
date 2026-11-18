import type {
	CaseDraft,
	CaseDraftRemovedStep,
	CaseDraftStep,
	CaseFlowStep,
	CatalogCase,
} from "@yoqa/runner-client";

/**
 * Writing a Case draft: the chat agent's proposed steps for the chat's Test Case. A step
 * keeps the id of the saved step it came from, so the draft always knows what it changed.
 * Each change answers the new draft, or why it cannot be made. Steps are numbered from 1.
 */

/** A step as the agent writes it. */
export type DraftStepText = { instructions: string; expectedResult: string };

/**
 * A step of `set_draft_steps`: optionally the number of the saved step it rewrites, and its
 * own reason in place of the whole call's.
 */
export type DraftStepInput = DraftStepText & { savedStep?: number; reason?: string };

/** A new draft of `catalogCase`: its steps, as saved. */
export function startDraft(catalogCase: CatalogCase): CaseDraft {
	return {
		caseId: catalogCase.id,
		base: catalogCase.flows,
		steps: catalogCase.flows.map((step) => ({ ...step, reason: null })),
		removed: [],
		passingRunId: null,
		learnedScript: null,
		updatedAt: Date.now(),
	};
}

/** The saved step a draft step came from; undefined for a step the agent added. */
export function savedStepOf(draft: CaseDraft, stepId: string): CaseFlowStep | undefined {
	return draft.base.find((step) => step.id === stepId);
}

function sameText(a: DraftStepText, b: DraftStepText): boolean {
	return a.instructions === b.instructions && a.expectedResult === b.expectedResult;
}

/**
 * `text` as a step of the draft: in place of saved step `saved` (if any), with its reason.
 * A step as saved keeps the reason only if it turns out moved (see `withSteps`).
 */
function draftStep(
	saved: CaseFlowStep | undefined,
	text: DraftStepText,
	reason: string,
): CaseDraftStep {
	if (saved && sameText(saved, text)) return { ...saved, reason };
	return {
		// The catalog's own step id prefix, so applying the draft keeps the id.
		id: saved?.id ?? `cf_${crypto.randomUUID()}`,
		instructions: text.instructions,
		expectedResult: text.expectedResult,
		// Its own text now, no longer a reusable Flow's.
		flowId: null,
		reason,
	};
}

/** The saved steps `steps` leaves out, in saved order, keeping the reason each was first removed for. */
function removedFrom(
	draft: CaseDraft,
	steps: CaseDraftStep[],
	reason: string,
): CaseDraftRemovedStep[] {
	const kept = new Set(steps.map((step) => step.id));
	return draft.base
		.filter((step) => !kept.has(step.id))
		.map((before) => ({
			before,
			reason: draft.removed.find((row) => row.before.id === before.id)?.reason ?? reason,
		}));
}

/**
 * The positions in `steps` that keep their saved order: the longest run of saved steps whose
 * saved positions only go up. The other saved steps were moved.
 */
function inSavedOrder(draft: CaseDraft, steps: CaseDraftStep[]): Set<number> {
	const savedIndex = new Map(draft.base.map((step, index) => [step.id, index]));
	const saved = steps.flatMap((step, at) => {
		const index = savedIndex.get(step.id);
		return index === undefined ? [] : [{ at, index }];
	});
	// The longest such run ending at each saved step, and the step before it in that run.
	const runs = saved.map(() => ({ length: 1, previous: -1 }));
	saved.forEach((step, i) => {
		const run = runs[i] as (typeof runs)[number];
		saved.slice(0, i).forEach((before, j) => {
			const candidate = (runs[j] as (typeof runs)[number]).length + 1;
			if (before.index < step.index && candidate > run.length) {
				run.length = candidate;
				run.previous = j;
			}
		});
	});
	const kept = new Set<number>();
	let i = runs.reduce((best, run, at) => (run.length > (runs[best]?.length ?? 0) ? at : best), 0);
	while (i >= 0 && saved[i]) {
		kept.add((saved[i] as (typeof saved)[number]).at);
		i = (runs[i] as (typeof runs)[number]).previous;
	}
	return kept;
}

/**
 * The draft with `steps`. A step as saved and in its saved order is unchanged (no reason); one
 * as saved but moved keeps a reason, its own or this change's. Any change clears the passing
 * Run and its Case Script: the draft must pass again.
 */
function withSteps(draft: CaseDraft, steps: CaseDraftStep[], reason: string): CaseDraft {
	const ordered = inSavedOrder(draft, steps);
	const marked = steps.map((step, at) => {
		const saved = savedStepOf(draft, step.id);
		if (!saved || !sameText(saved, step)) return step;
		return { ...step, reason: ordered.has(at) ? null : (step.reason ?? reason) };
	});
	return {
		...draft,
		steps: marked,
		removed: removedFrom(draft, marked, reason),
		passingRunId: null,
		learnedScript: null,
		updatedAt: Date.now(),
	};
}

/**
 * Whether the Test Case's steps are no longer those the draft started from: steps added,
 * removed, reordered or relinked, or a step's own text edited. A step of a reusable Flow only
 * has to keep its Flow: the Flow's text may change, and applying keeps the link.
 */
export function caseEditedSince(draft: CaseDraft, steps: CaseFlowStep[]): boolean {
	return (
		steps.length !== draft.base.length ||
		steps.some((step, index) => {
			const base = draft.base[index];
			if (!base || step.id !== base.id || step.flowId !== base.flowId) return true;
			return step.flowId === null && !sameText(step, base);
		})
	);
}

function stepIndex(draft: CaseDraft, step: number): number | string {
	if (step < 1 || step > draft.steps.length) {
		return `There is no step ${step}: the Case draft has ${draft.steps.length} steps.`;
	}
	return step - 1;
}

/**
 * Replace the whole draft. A step naming its saved step rewrites it; a step written exactly as
 * an unused saved step is that step, unchanged; any other is added. Saved steps left out are removed.
 */
export function setSteps(
	draft: CaseDraft,
	inputs: DraftStepInput[],
	reason: string,
): CaseDraft | string {
	// Saved steps named by number first, so a step matched by its text never takes one of them.
	const used = new Set<string>();
	for (const input of inputs) {
		if (input.savedStep === undefined) continue;
		const saved = draft.base[input.savedStep - 1];
		if (!saved) {
			return `There is no saved step ${input.savedStep}: the Test Case has ${draft.base.length} steps.`;
		}
		if (used.has(saved.id)) return `Saved step ${input.savedStep} is used twice.`;
		used.add(saved.id);
	}
	const steps = inputs.map((input) => {
		let saved: CaseFlowStep | undefined;
		if (input.savedStep !== undefined) {
			saved = draft.base[input.savedStep - 1];
		} else {
			saved = draft.base.find((step) => !used.has(step.id) && sameText(step, input));
			if (saved) used.add(saved.id);
		}
		return draftStep(saved, input, input.reason ?? reason);
	});
	return withSteps(draft, steps, reason);
}

/**
 * Add a step at `position` (the step it becomes), or at the end. Written exactly as a saved
 * step the draft leaves out, it is that step back.
 */
export function addStep(
	draft: CaseDraft,
	text: DraftStepText,
	position: number | undefined,
	reason: string,
): CaseDraft | string {
	const at = position ?? draft.steps.length + 1;
	if (at < 1 || at > draft.steps.length + 1) {
		return `Position ${at} is outside the Case draft: use 1 to ${draft.steps.length + 1}.`;
	}
	const inDraft = new Set(draft.steps.map((step) => step.id));
	const removed = draft.base.find((step) => !inDraft.has(step.id) && sameText(step, text));
	const steps = [...draft.steps];
	steps.splice(at - 1, 0, draftStep(removed, text, reason));
	return withSteps(draft, steps, reason);
}

/** Change a step's instructions, expected result, or both. Changed back to as saved, it is unchanged again. */
export function changeStep(
	draft: CaseDraft,
	step: number,
	change: Partial<DraftStepText>,
	reason: string,
): CaseDraft | string {
	const index = stepIndex(draft, step);
	if (typeof index === "string") return index;
	const current = draft.steps[index] as CaseDraftStep;
	const text = {
		instructions: change.instructions ?? current.instructions,
		expectedResult: change.expectedResult ?? current.expectedResult,
	};
	const saved = savedStepOf(draft, current.id);
	const changed = saved
		? draftStep(saved, text, reason)
		: { ...current, ...text, reason: sameText(current, text) ? current.reason : reason };
	const steps = draft.steps.map((row, at) => (at === index ? changed : row));
	return withSteps(draft, steps, reason);
}

/** Remove a step: a saved one shows as removed, with `reason`; an added one is gone. */
export function removeStep(draft: CaseDraft, step: number, reason: string): CaseDraft | string {
	const index = stepIndex(draft, step);
	if (typeof index === "string") return index;
	return withSteps(
		draft,
		draft.steps.filter((_, at) => at !== index),
		reason,
	);
}

/**
 * The draft as text for the chat agent: each step with what changed (moved, changed or added)
 * and why, then what was removed.
 */
export function describeDraft(draft: CaseDraft, caseLabel: string): string {
	const lines = [`Case draft of ${caseLabel}:`];
	draft.steps.forEach((step, index) => {
		const saved = savedStepOf(draft, step.id);
		const what = !saved ? "added" : sameText(saved, step) ? "moved" : "changed";
		const note = step.reason ? ` (${what}: ${step.reason})` : "";
		lines.push(`${index + 1}. ${step.instructions || "(no instructions)"}${note}`);
		lines.push(`   Expected: ${step.expectedResult || "(none)"}`);
	});
	if (draft.steps.length === 0) lines.push("No steps.");
	for (const row of draft.removed) {
		lines.push(`Removed: ${row.before.instructions || "(no instructions)"} (${row.reason})`);
	}
	return lines.join("\n");
}
