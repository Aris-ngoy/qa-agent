import type { RunStep } from "@yoqa/runner-client";
import { flattenCaseInstructions } from "./agent";

/** A step's text as a Run of a case ran it. */
export type RanStep = { instructions: string; expectedResult: string };

/** An agent step whose verify accepted its instruction: the agent moves on to the next one. */
function verified(step: RunStep): boolean {
	return step.action.cycle?.verify?.type === "verify";
}

/**
 * The step of `flows` (from 0) an agent Run is on, or ended on: the last Run step's, or the
 * next one once that step verified the last instruction its step of the case splits into.
 */
export function reachedStep(runSteps: RunStep[], flows: RanStep[]): number {
	const last = runSteps.at(-1);
	const at = last?.action.flowStep ?? 0;
	if (!last || !verified(last)) return at;
	const flow = flows[at];
	const done = runSteps.filter((step) => step.action.flowStep === at && verified(step)).length;
	const next = flow && done >= flattenCaseInstructions([flow]).length ? at + 1 : at;
	return Math.min(next, flows.length - 1);
}
