import { describe, expect, test } from "bun:test";
import {
	type RunReportDocument,
	actionSummary,
	formatRunReportGithubSummary,
	formatRunReportHtml,
	formatRunReportMarkdown,
	formatStepCommand,
	formatStepPhases,
	readStepCycle,
	stepReasoning,
	suggestedRunReportBasename,
} from "./run-report";

describe("readStepCycle", () => {
	test("reads action, decision, and verify off a step", () => {
		const cycle = readStepCycle({
			type: "done",
			reason: "home visible",
			thoughts: "ok",
			cycle: {
				action: { type: "tap", x: 10, y: 20, reason: "Tap play", thoughts: "button" },
				decision: { type: "done", reason: "home visible", thoughts: "ok" },
				verify: { type: "verify", reason: "Success text is visible", thoughts: "done" },
			},
		});
		expect(cycle?.action).toMatchObject({ type: "tap", x: 10 });
		expect(cycle?.verify.type).toBe("verify");
		expect(
			actionSummary({
				type: "done",
				cycle: {
					action: { type: "tap", label: "Play" },
					decision: { type: "done" },
					verify: { type: "verify", reason: "ok", thoughts: "ok" },
				},
			}),
		).toBe("Tap: Play");
	});
});

describe("actionSummary", () => {
	test("maps known action types", () => {
		expect(actionSummary({ type: "tap" })).toBe("Tap");
		expect(actionSummary({ type: "tap", label: "Increment" })).toBe("Tap: Increment");
		expect(actionSummary({ type: "tap", id: "submit" })).toBe("Tap #submit");
		expect(actionSummary({ type: "type", text: "hi" })).toBe("Type: hi");
		expect(actionSummary({ type: "wait" })).toBe("Wait");
		expect(actionSummary({ type: "alert" })).toBe("Accept alert");
		expect(actionSummary({ type: "alert", alertAction: "dismiss" })).toBe("Dismiss alert");
		expect(actionSummary({ type: "assert", assertion: "visible", text: "Yoqa Demo" })).toBe(
			"Assert visible: Yoqa Demo",
		);
		expect(actionSummary({ type: "fail" })).toBe("Failed");
		expect(actionSummary({ type: "swipe", direction: "up" })).toBe("Swipe up");
		expect(actionSummary({ type: "swipe", x: 500, y: 800, x2: 500, y2: 200 })).toBe("Swipe up");
		expect(actionSummary({ type: "swipe", x: 500, y: 200, x2: 500, y2: 800 })).toBe("Swipe down");
		expect(actionSummary({ type: "input", text: "x" })).toBe("Input: x");
		expect(actionSummary({ type: "drag" })).toBe("Drag");
		expect(actionSummary({ type: "open-url", url: "https://example.com" })).toBe(
			"Open URL: https://example.com",
		);
		expect(actionSummary({ type: "restart-app" })).toBe("Restart app");
	});

	test("falls back for unknown or invalid payloads", () => {
		expect(actionSummary(null)).toBe("Step");
		expect(actionSummary({ type: "custom" })).toBe("Custom");
	});
});

describe("formatStepCommand", () => {
	test("maps device actions to yoqa shell lines", () => {
		expect(formatStepCommand({ type: "tap", label: "Allow" })).toBe(
			"yoqa action tap --label 'Allow'",
		);
		expect(formatStepCommand({ type: "tap", id: "submit" })).toBe("yoqa action tap --id 'submit'");
		expect(formatStepCommand({ type: "tap", x: 100, y: 200 })).toBe(
			"yoqa action tap --x 100 --y 200",
		);
		expect(
			formatStepCommand({ type: "swipe", x: 500, y: 800, x2: 500, y2: 200, durationMs: 400 }),
		).toBe("yoqa action swipe --x 500 --y 800 --x2 500 --y2 200 --duration 400");
		expect(formatStepCommand({ type: "type", text: "hello" })).toBe(
			"yoqa action input --text 'hello'",
		);
		expect(formatStepCommand({ type: "wait", ms: 1500 })).toBe("sleep 1.5");
		expect(formatStepCommand({ type: "assert", assertion: "visible", text: "Yoqa Demo" })).toBe(
			"yoqa assert visible --text 'Yoqa Demo'",
		);
		expect(formatStepCommand({ type: "alert" })).toBe("yoqa action alert");
		expect(formatStepCommand({ type: "alert", alertAction: "dismiss" })).toBe(
			"yoqa action alert --dismiss",
		);
		expect(formatStepCommand({ type: "drag", x: 10, y: 20, x2: 30, y2: 40, durationMs: 250 })).toBe(
			"yoqa action drag --x 10 --y 20 --x2 30 --y2 40 --duration 250",
		);
		expect(formatStepCommand({ type: "activate-app", appId: "com.example.app" })).toBe(
			"yoqa action activate-app --app-id 'com.example.app'",
		);
		expect(formatStepCommand({ type: "terminate-app", appId: "com.example.app" })).toBe(
			"yoqa action terminate-app --app-id 'com.example.app'",
		);
		expect(formatStepCommand({ type: "restart-app", appId: "com.example.app" })).toBe(
			"yoqa action restart-app --app-id 'com.example.app'",
		);
		expect(formatStepCommand({ type: "background-app", seconds: 3 })).toBe(
			"yoqa action background-app --seconds 3",
		);
		expect(formatStepCommand({ type: "open-url", url: "https://example.com" })).toBe(
			"yoqa action open-url --url 'https://example.com'",
		);
		expect(formatStepCommand({ type: "tap", x: 10, y: 20, double: true })).toBe(
			"yoqa action tap --x 10 --y 20 --double",
		);
	});

	test("returns null for terminal or unknown actions", () => {
		expect(formatStepCommand({ type: "done" })).toBeNull();
		expect(formatStepCommand({ type: "verify" })).toBeNull();
		expect(formatStepCommand({ type: "fail" })).toBeNull();
		expect(formatStepCommand(null)).toBeNull();
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
						command: "yoqa action tap --label 'Allow'",
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
						command: "yoqa action tap --label 'Login'",
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
						command: "sleep 1",
						screenshotBase64: "CCCC",
					},
				],
			},
		],
		...overrides,
	};
}

describe("per-phase step timing", () => {
	test("renders the breakdown in markdown and HTML when the step has phases", () => {
		const base = sampleDoc();
		const baseTest = base.tests[0];
		const baseStep = baseTest?.steps[0];
		if (!baseTest || !baseStep) throw new Error("sample doc is missing a step");
		const doc: RunReportDocument = {
			...base,
			tests: [
				{
					...baseTest,
					steps: [
						{
							...baseStep,
							latencyMs: 34740,
							phases: {
								captureMs: 820,
								screenMs: 1100,
								prepareMs: 95,
								decideMs: 32400,
								actionMs: 210,
								settleMs: 800,
								decideRetries: 1,
							},
						},
					],
				},
			],
		};
		const markdown = formatRunReportMarkdown(doc);
		expect(markdown).toContain(
			"Phases: capture 820ms · screen 1100ms · image 95ms · decide 32400ms · action 210ms · settle 800ms · retries 1",
		);
		expect(formatRunReportHtml(doc)).toContain("capture 820ms");
	});

	test("shows the step's Call usage and cached share after the phases", () => {
		const base = sampleDoc();
		const baseTest = base.tests[0];
		const baseStep = baseTest?.steps[0];
		if (!baseTest || !baseStep) throw new Error("sample doc is missing a step");
		const doc: RunReportDocument = {
			...base,
			tests: [
				{
					...baseTest,
					steps: [
						{
							...baseStep,
							phases: {
								captureMs: 820,
								screenMs: 1100,
								prepareMs: 95,
								decideMs: 32400,
								actionMs: 210,
								settleMs: 800,
								decideRetries: 0,
								usage: {
									inputTokens: 250,
									cachedInputTokens: 1800,
									cacheWriteTokens: 900,
									outputTokens: 60,
								},
							},
						},
					],
				},
			],
		};
		expect(formatRunReportMarkdown(doc)).toContain(
			"settle 800ms · tokens in 250, cached 1800, cache write 900, out 60 (61% cached)",
		);
		expect(formatRunReportHtml(doc)).toContain("61% cached");
	});

	test("leaves out unreported Call usage fields and shows no usage when phases have none", () => {
		const usageOnly = formatStepPhases({
			captureMs: 0,
			screenMs: 0,
			prepareMs: 0,
			decideMs: 0,
			actionMs: 0,
			settleMs: 0,
			decideRetries: 0,
			usage: {
				inputTokens: 100,
				cachedInputTokens: null,
				cacheWriteTokens: null,
				outputTokens: 20,
			},
		});
		expect(usageOnly).toContain("tokens in 100, out 20 (0% cached)");
		const none = formatStepPhases({
			captureMs: 0,
			screenMs: 0,
			prepareMs: 0,
			decideMs: 0,
			actionMs: 0,
			settleMs: 0,
			decideRetries: 0,
		});
		expect(none).not.toContain("tokens");
	});

	test("omits the breakdown for steps without phases", () => {
		const markdown = formatRunReportMarkdown(sampleDoc());
		expect(markdown).not.toContain("Phases:");
		expect(formatRunReportHtml(sampleDoc())).not.toContain("capture ");
	});
});

describe("Screen mode in the report", () => {
	test("shows the Screen mode of a catalog run in every format", () => {
		const doc: RunReportDocument = { ...sampleDoc(), screenMode: "vision" };
		expect(formatRunReportMarkdown(doc)).toContain("| Screen | vision |");
		expect(formatRunReportGithubSummary(doc)).toContain("| Screen | vision |");
	});

	test("names the Lane that ran", () => {
		const doc = {
			...sampleDoc(),
			lane: "appium",
			laneWarning: "Direct lane is not available; fell back to Appium",
		};
		expect(formatRunReportMarkdown(doc)).toContain("| Lane | appium |");
		expect(formatRunReportMarkdown(doc)).toContain("fell back to Appium");
		expect(formatRunReportGithubSummary(doc)).toContain("| Lane | appium |");
		expect(formatRunReportHtml(doc)).toContain("appium");
	});

	test("omits the Screen row when the run has no Screen mode", () => {
		expect(formatRunReportMarkdown(sampleDoc())).not.toContain("| Screen |");
		expect(formatRunReportGithubSummary(sampleDoc())).not.toContain("| Screen |");
	});
});

describe("formatRunReportGithubSummary", () => {
	test("lists failed steps and omits screenshot data URIs", () => {
		const markdown = formatRunReportGithubSummary(sampleDoc());
		expect(markdown).toContain("**Failed**");
		expect(markdown).toContain("| #1 Login | Failed | 2 |");
		expect(markdown).toContain("| #2 Home | Passed | 1 |");
		expect(markdown).toContain("step 2: Tap login");
		expect(markdown).toContain("Command: `yoqa action tap --label 'Login'`");
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
								command: null,
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

describe("formatRunReportHtml and Markdown", () => {
	test("render the step command", () => {
		const doc = sampleDoc();
		const html = formatRunReportHtml(doc);
		expect(html).toContain("<code>yoqa action tap --label &#39;Allow&#39;</code>");
		expect(html).toContain("<code>yoqa action tap --label &#39;Login&#39;</code>");

		const markdown = formatRunReportMarkdown(doc);
		expect(markdown).toContain("- Command: `yoqa action tap --label 'Allow'`");
		expect(markdown).toContain("- Command: `yoqa action tap --label 'Login'`");
	});
});
