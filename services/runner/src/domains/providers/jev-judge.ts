import type { InstructionJudgeVerdict, JudgeProposed } from "./drivers/types";

export const JEV_DEFAULT_MODEL = "jev-latest";
export const JEV_PINNED_MODEL = "jev-1.13.0";

/** Confirm verify/done only at or above this noul. */
export const JEV_COMPLETE_THRESHOLD = 0.7;
/** Treat the screen as blocked at or above this noul. */
export const JEV_BLOCKED_THRESHOLD = 0.6;
/** Fail confirmation requires instruction_complete below this. */
export const JEV_FAIL_COMPLETE_MAX = 0.4;
/** still_blocked must be below this to confirm completion. */
export const JEV_UNBLOCKED_MAX = 0.4;

export const JEV_INSTRUCTION_COMPLETE =
	"Has `instruction` been carried out, given `recent_actions` and what is visible in `screen`?";
export const JEV_EXPECTED_VISIBLE =
	"Is `expected_result` visible in `screen`? If `expected_result` is (none), answer yes.";
export const JEV_STILL_BLOCKED =
	"Is the app still on the wrong screen or blocked from completing `instruction`, given `screen` and `recent_actions`?";

export type JevNoulScores = {
	instructionComplete: number;
	expectedVisible: number;
	stillBlocked: number;
};

export function mergeJevModelCatalog(
	cards: Array<{ name: string }>,
): Array<{ id: string; name: string }> {
	const models = cards.map((card) => ({ id: card.name, name: card.name }));
	if (!models.some((model) => model.id === JEV_PINNED_MODEL)) {
		models.push({ id: JEV_PINNED_MODEL, name: JEV_PINNED_MODEL });
	}
	return models;
}

export function formatJevScores(scores: JevNoulScores): string {
	return [
		`instruction_complete=${scores.instructionComplete.toFixed(2)}`,
		`expected_visible=${scores.expectedVisible.toFixed(2)}`,
		`still_blocked=${scores.stillBlocked.toFixed(2)}`,
	].join(" ");
}

function isComplete(scores: JevNoulScores, hasExpected: boolean): boolean {
	const expectedOk = !hasExpected || scores.expectedVisible >= JEV_COMPLETE_THRESHOLD;
	return (
		scores.instructionComplete >= JEV_COMPLETE_THRESHOLD &&
		scores.stillBlocked < JEV_UNBLOCKED_MAX &&
		expectedOk
	);
}

function isBlocked(scores: JevNoulScores): boolean {
	return (
		scores.stillBlocked >= JEV_BLOCKED_THRESHOLD &&
		scores.instructionComplete < JEV_FAIL_COMPLETE_MAX
	);
}

export function composeInstructionVerdict(input: {
	proposed: JudgeProposed;
	hasExpected: boolean;
	scores: JevNoulScores;
}): Pick<InstructionJudgeVerdict, "outcome" | "reason" | "thoughts"> {
	const { proposed, hasExpected, scores } = input;
	const scoreLine = formatJevScores(scores);
	const complete = isComplete(scores, hasExpected);
	const blocked = isBlocked(scores);

	if (proposed === "fail") {
		if (complete) {
			return {
				outcome: "confirm",
				reason: "Jev judged the instruction complete despite a vision fail.",
				thoughts: `The accessibility tree matches the instruction, so this step should pass. ${scoreLine}`,
			};
		}
		if (blocked) {
			return {
				outcome: "fail",
				reason: "Jev agrees the instruction is blocked.",
				thoughts: `The screen still does not show progress on this instruction. ${scoreLine}`,
			};
		}
		return {
			outcome: "continue",
			reason: "Jev is uncertain about the vision fail — keep going.",
			thoughts: `The fail claim is not confirmed. Try another action from the current screen. ${scoreLine}`,
		};
	}

	if (complete) {
		return {
			outcome: "confirm",
			reason: "Jev confirmed the instruction is complete.",
			thoughts: `The tree shows the instruction was carried out. ${scoreLine}`,
		};
	}

	return {
		outcome: "continue",
		reason: "Jev rejected a premature verify/done.",
		thoughts: `The current screen does not yet satisfy the instruction. Continue acting. ${scoreLine}`,
	};
}
