import { describe, expect, test } from "bun:test";
import {
	type RunReportDocument,
	actionSummary,
	stepReasoning,
	suggestedRunReportBasename,
} from "./run-report";

describe("actionSummary", () => {
	test("maps known action types", () => {
		expect(actionSummary({ type: "tap" })).toBe("Tap");
		expect(actionSummary({ type: "type", text: "hi" })).toBe("Type: hi");
		expect(actionSummary({ type: "wait" })).toBe("Wait");
		expect(actionSummary({ type: "fail" })).toBe("Failed");
		expect(actionSummary({ type: "input", text: "x" })).toBe("Input: x");
	});

	test("falls back for unknown or invalid payloads", () => {
		expect(actionSummary(null)).toBe("Step");
		expect(actionSummary({ type: "custom" })).toBe("Custom");
	});
});

describe("stepReasoning", () => {
	test("prefers action reason and dedupes thoughts", () => {
		expect(
			stepReasoning({
				action: { reason: "Tap login", thoughts: "Tap login" },
				detail: "ignored when reason exists",
			}),
		).toEqual({ reason: "Tap login", thoughts: null });

		expect(
			stepReasoning({
				action: { reason: "Tap login", thoughts: "Button is visible" },
				detail: null,
			}),
		).toEqual({ reason: "Tap login", thoughts: "Button is visible" });

		expect(stepReasoning({ action: null, detail: " from detail " })).toEqual({
			reason: "from detail",
			thoughts: null,
		});
	});
});

describe("suggestedRunReportBasename", () => {
	test("builds a stable slug from id and status", () => {
		const doc: RunReportDocument = {
			id: "run_abc-123!",
			source: "catalog",
			status: "passed",
			title: "Suite",
			appLabel: null,
			deviceLabel: null,
			platform: null,
			executionMode: null,
			error: null,
			createdAt: 1,
			startedAt: null,
			finishedAt: null,
			tests: [],
		};
		expect(suggestedRunReportBasename(doc)).toBe("yoqa-run-runabc12-passed");
	});
});
