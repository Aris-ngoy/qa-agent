import { describe, expect, test } from "bun:test";
import { JEV_PINNED_MODEL, composeInstructionVerdict, mergeJevModelCatalog } from "./jev-judge";

describe("composeInstructionVerdict", () => {
	const doneScores = {
		instructionComplete: 0.92,
		expectedVisible: 0.88,
		stillBlocked: 0.08,
	};
	const prematureScores = {
		instructionComplete: 0.31,
		expectedVisible: 0.22,
		stillBlocked: 0.74,
	};
	const uncertainScores = {
		instructionComplete: 0.52,
		expectedVisible: 0.48,
		stillBlocked: 0.45,
	};

	test("confirms verify when the instruction looks complete", () => {
		const verdict = composeInstructionVerdict({
			proposed: "verify",
			hasExpected: true,
			scores: doneScores,
		});
		expect(verdict.outcome).toBe("confirm");
	});

	test("continues when verify is premature", () => {
		const verdict = composeInstructionVerdict({
			proposed: "verify",
			hasExpected: true,
			scores: prematureScores,
		});
		expect(verdict.outcome).toBe("continue");
	});

	test("overrides a false fail when the instruction is complete", () => {
		const verdict = composeInstructionVerdict({
			proposed: "fail",
			hasExpected: true,
			scores: doneScores,
		});
		expect(verdict.outcome).toBe("confirm");
	});

	test("confirms fail when the screen is still blocked", () => {
		const verdict = composeInstructionVerdict({
			proposed: "fail",
			hasExpected: true,
			scores: prematureScores,
		});
		expect(verdict.outcome).toBe("fail");
	});

	test("continues an uncertain fail", () => {
		const verdict = composeInstructionVerdict({
			proposed: "fail",
			hasExpected: true,
			scores: uncertainScores,
		});
		expect(verdict.outcome).toBe("continue");
	});

	test("skips expected_visible when the instruction has no expected result", () => {
		const verdict = composeInstructionVerdict({
			proposed: "done",
			hasExpected: false,
			scores: { instructionComplete: 0.9, expectedVisible: 0.1, stillBlocked: 0.1 },
		});
		expect(verdict.outcome).toBe("confirm");
	});
});

describe("mergeJevModelCatalog", () => {
	test("pins jev-1.13.0 when the catalog only returns aliases", () => {
		const models = mergeJevModelCatalog([{ name: "jev-latest" }, { name: "jev-preview" }]);
		expect(models.map((model) => model.id)).toEqual([
			"jev-latest",
			"jev-preview",
			JEV_PINNED_MODEL,
		]);
	});

	test("does not duplicate the pinned version", () => {
		const models = mergeJevModelCatalog([{ name: "jev-latest" }, { name: JEV_PINNED_MODEL }]);
		expect(models.filter((model) => model.id === JEV_PINNED_MODEL)).toHaveLength(1);
	});
});
