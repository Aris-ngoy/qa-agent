import { describe, expect, test } from "bun:test";
import {
	type RunReportDocument,
	actionSummary,
	formatRunReportGithubSummary,
	stepReasoning,
	suggestedRunReportBasename,
} from "./run-report";

describe("actionSummary", () => {
	test("maps known action types", () => {
		expect(actionSummary({ type: "tap" })).toBe("Tap");
		expect(actionSummary({ type: "tap", label: "Increment" })).toBe("Tap: Increment");
		expect(actionSummary({ type: "tap", id: "submit" })).toBe("Tap #submit");
		expect(actionSummary({ type: "type", text: "hi" })).toBe("Type: hi");
		expect(actionSummary({ type: "wait" })).toBe("Wait");
		expect(actionSummary({ type: "assert", assertion: "visible", text: "Yoqa Demo" })).toBe(
			"Assert visible: Yoqa Demo",
		);
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

function sampleDoc(overrides: Partial<RunReportDocument> = {}): RunReportDocument {
	return {
		id: "run_fail_1",
		source: "catalog",
		status: "errored",
		title: "Login suite",
		appLabel: "DEMO — Demo",
		deviceLabel: "iPhone 16 · ios 18.0",
		platform: "ios",
		executionMode: "script",
		error: "Case #1 failed",
		createdAt: 1,
		startedAt: 1,
		finishedAt: 4_000,
		tests: [
			{
				id: "t1",
				title: "#1 Login",
				status: "errored",
				executionMode: "script",
				error: "Button missing",
				startedAt: 1,
				finishedAt: 3_000,
				steps: [
					{
						id: "s1",
						index: 1,
						summary: "Tap",
						ok: true,
						latencyMs: 12,
						detail: null,
						reason: null,
						thoughts: null,
						screenshotBase64: "AAAABBBB",
					},
					{
						id: "s2",
						index: 2,
						summary: "Tap login",
						ok: false,
						latencyMs: 40,
						detail: "No matching element",
						reason: "Login button not found",
						thoughts: "Looking around",
						screenshotBase64: "iVBORw0KGgo=",
					},
				],
			},
			{
				id: "t2",
				title: "#2 Home",
				status: "passed",
				executionMode: "script",
				error: null,
				startedAt: 3_000,
				finishedAt: 4_000,
				steps: [
					{
						id: "s3",
						index: 1,
						summary: "Wait",
						ok: true,
						latencyMs: 8,
						detail: null,
						reason: null,
						thoughts: null,
						screenshotBase64: "CCCC",
					},
				],
			},
		],
		...overrides,
	};
}

describe("formatRunReportGithubSummary", () => {
	test("lists failed steps and omits screenshot data URIs", () => {
		const markdown = formatRunReportGithubSummary(sampleDoc());
		expect(markdown).toContain("**Failed**");
		expect(markdown).toContain("| #1 Login | Failed | 2 |");
		expect(markdown).toContain("| #2 Home | Passed | 1 |");
		expect(markdown).toContain("step 2: Tap login");
		expect(markdown).toContain("Reason: Login button not found");
		expect(markdown).toContain("Download the `yoqa-report` artifact");
		expect(markdown).not.toContain("data:image");
		expect(markdown).not.toContain("iVBORw0KGgo=");
		expect(markdown.length).toBeLessThan(8_000);
	});

	test("omits the failed-steps section when everything passed", () => {
		const markdown = formatRunReportGithubSummary(
			sampleDoc({
				status: "passed",
				error: null,
				tests: [
					{
						id: "t1",
						title: "#1 Login",
						status: "passed",
						executionMode: "script",
						error: null,
						startedAt: 1,
						finishedAt: 2,
						steps: [
							{
								id: "s1",
								index: 1,
								summary: "Tap",
								ok: true,
								latencyMs: 10,
								detail: null,
								reason: null,
								thoughts: null,
								screenshotBase64: "AAA",
							},
						],
					},
				],
			}),
		);
		expect(markdown).toContain("**Passed**");
		expect(markdown).not.toContain("### Failed steps");
		expect(markdown).not.toContain("data:image");
	});

	test("renders cancelled status without screenshots", () => {
		const markdown = formatRunReportGithubSummary(
			sampleDoc({
				status: "cancelled",
				error: "Cancelled by user",
				tests: [
					{
						id: "t1",
						title: "#1 Login",
						status: "cancelled",
						executionMode: "agent",
						error: null,
						startedAt: 1,
						finishedAt: 2,
						steps: [],
					},
				],
			}),
		);
		expect(markdown).toContain("**Cancelled**");
		expect(markdown).toContain("| #1 Login | Cancelled | 0 |");
		expect(markdown).not.toContain("data:image");
	});
});
