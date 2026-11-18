import { describe, expect, test } from "bun:test";
import type { CaseDraft, CaseFlowStep } from "@yoqa/runner-client";
import { applyBlocker, draftChangeRows, unchangedLabel } from "./case-draft";

function saved(id: string, instructions: string): CaseFlowStep {
	return { id, instructions, expectedResult: `${instructions} done`, flowId: null };
}

const open = saved("s1", "Open the app");
const signIn = saved("s2", "Tap Sign in");
const password = saved("s3", "Type the password");
const submit = saved("s4", "Tap Submit");

function draftOf(steps: CaseDraft["steps"], removed: CaseDraft["removed"] = []): CaseDraft {
	return {
		caseId: "case_1",
		base: [open, signIn, password, submit],
		steps,
		removed,
		passingRunId: null,
		learnedScript: null,
		updatedAt: 1,
	};
}

const asSaved = (step: CaseFlowStep) => ({ ...step, reason: null });

describe("draftChangeRows", () => {
	test("collapses stretches of unchanged steps around a changed one, with its before and after", () => {
		const renamed = { ...signIn, instructions: "Tap Log in", reason: "Renamed" };
		const draft = draftOf([asSaved(open), renamed, asSaved(password), asSaved(submit)]);

		expect(draftChangeRows(draft)).toEqual([
			{ kind: "unchanged", from: 1, to: 1 },
			{ kind: "changed", number: 2, before: signIn, after: renamed, reason: "Renamed" },
			{ kind: "unchanged", from: 3, to: 4 },
		]);
	});

	test("shows an added step, and a removed one where it was in the saved case", () => {
		const added = {
			id: "new_1",
			instructions: "Tap Continue",
			expectedResult: "Home shows",
			flowId: null,
			reason: "A new screen",
		};
		const draft = draftOf(
			[asSaved(open), asSaved(password), added, asSaved(submit)],
			[{ before: signIn, reason: "Login opens by itself" }],
		);

		expect(draftChangeRows(draft)).toEqual([
			{ kind: "unchanged", from: 1, to: 1 },
			{ kind: "removed", savedNumber: 2, before: signIn, reason: "Login opens by itself" },
			{ kind: "unchanged", from: 2, to: 2 },
			{ kind: "added", number: 3, after: added, reason: "A new screen" },
			{ kind: "unchanged", from: 4, to: 4 },
		]);
	});

	test("saved steps removed at the end come last, in saved order", () => {
		const draft = draftOf(
			[asSaved(open)],
			[
				{ before: signIn, reason: "a" },
				{ before: password, reason: "b" },
				{ before: submit, reason: "c" },
			],
		);

		expect(draftChangeRows(draft).map((row) => row.kind)).toEqual([
			"unchanged",
			"removed",
			"removed",
			"removed",
		]);
	});

	test("a step moved out of its saved order shows as moved, and a removed step stays where it was among the steps in order", () => {
		const moved = { ...submit, reason: "Submit comes first now" };
		const draft = draftOf(
			[moved, asSaved(open), asSaved(password)],
			[{ before: signIn, reason: "Login opens by itself" }],
		);

		expect(draftChangeRows(draft)).toEqual([
			{ kind: "moved", number: 1, savedNumber: 4, after: moved, reason: "Submit comes first now" },
			{ kind: "unchanged", from: 2, to: 2 },
			{ kind: "removed", savedNumber: 2, before: signIn, reason: "Login opens by itself" },
			{ kind: "unchanged", from: 3, to: 3 },
		]);
	});

	test("a draft with nothing changed is one stretch of unchanged steps", () => {
		const draft = draftOf([open, signIn, password, submit].map(asSaved));

		expect(draftChangeRows(draft)).toEqual([{ kind: "unchanged", from: 1, to: 4 }]);
	});
});

describe("unchangedLabel", () => {
	test("names one step or a range", () => {
		expect(unchangedLabel({ from: 3, to: 3 })).toBe("Step 3 unchanged");
		expect(unchangedLabel({ from: 1, to: 2 })).toBe("Steps 1–2 unchanged");
	});
});

describe("applyBlocker", () => {
	const draft = draftOf([asSaved(open)]);

	test("Apply is off until a Run of the whole draft passed, saying why", () => {
		expect(applyBlocker(draft, false)).toBe(
			"Apply turns on once a Run of the whole draft passes. Ask the chat agent to run it.",
		);
		expect(applyBlocker(draft, true)).toBe(
			"A Run of the draft is in progress: Apply turns on if it passes.",
		);
	});

	test("Apply is on once the draft has a passing Run", () => {
		expect(applyBlocker({ ...draft, passingRunId: "run_1" }, false)).toBeNull();
		expect(applyBlocker({ ...draft, passingRunId: "run_1" }, true)).toBeNull();
	});
});
