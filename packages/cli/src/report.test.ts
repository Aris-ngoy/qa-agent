import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run, RunnerClient } from "@yoqa/runner-client";
import { formatGithubOutputLines, isGithubActions, resolveGithubWritePath } from "./github";
import {
	createWaitStatusLogger,
	exportCatalogRunReport,
	normalizeReportFormat,
	parseFailOn,
	parseTimeoutSeconds,
	resolveReportRunId,
	shouldFailOnRunStatus,
} from "./report";

describe("github helpers", () => {
	test("detects GitHub Actions", () => {
		expect(isGithubActions({ GITHUB_ACTIONS: "true" })).toBe(true);
		expect(isGithubActions({})).toBe(false);
	});

	test("auto-enables writes in GHA when a path is set", () => {
		const env = { GITHUB_ACTIONS: "true", GITHUB_OUTPUT: "/tmp/out" };
		expect(resolveGithubWritePath(undefined, env.GITHUB_OUTPUT, env)).toBe("/tmp/out");
		expect(resolveGithubWritePath(false, env.GITHUB_OUTPUT, env)).toBeNull();
		expect(resolveGithubWritePath(true, "/tmp/forced", {})).toBe("/tmp/forced");
		expect(resolveGithubWritePath(undefined, "/tmp/out", {})).toBeNull();
		expect(resolveGithubWritePath(undefined, undefined, env)).toBeNull();
	});

	test("formats GitHub output lines", () => {
		expect(formatGithubOutputLines({ run_id: "run_1", status: "passed" })).toBe(
			"run_id=run_1\nstatus=passed\n",
		);
		expect(() => formatGithubOutputLines({ bad: "a\nb" })).toThrow(/newlines/);
	});
});

describe("report helpers", () => {
	test("normalizes format", () => {
		expect(normalizeReportFormat(undefined)).toBe("html");
		expect(normalizeReportFormat("markdown")).toBe("md");
		expect(normalizeReportFormat("md")).toBe("md");
		expect(() => normalizeReportFormat("pdf")).toThrow(/html or md/);
	});

	test("parses --fail-on and --timeout", () => {
		expect(parseFailOn(undefined)).toBe("never");
		expect(parseFailOn("errored")).toBe("errored");
		expect(() => parseFailOn("always")).toThrow(/errored or never/);
		expect(parseTimeoutSeconds(undefined)).toBe(1800);
		expect(parseTimeoutSeconds("60")).toBe(60);
		expect(() => parseTimeoutSeconds("0")).toThrow(/positive/);
	});

	test("fail-on errored only fails errored runs", () => {
		expect(shouldFailOnRunStatus("never", "errored")).toBe(false);
		expect(shouldFailOnRunStatus("errored", "errored")).toBe(true);
		expect(shouldFailOnRunStatus("errored", "cancelled")).toBe(false);
		expect(shouldFailOnRunStatus("errored", "passed")).toBe(false);
	});

	test("resolveReportRunId requires id or --latest", async () => {
		await expect(
			resolveReportRunId({ listRuns: async () => [] }, undefined, undefined, "APP"),
		).rejects.toThrow(/run id or --latest/);
		await expect(
			resolveReportRunId({ listRuns: async () => [] }, "run_1", "app_1", "APP"),
		).rejects.toThrow(/not both/);
		expect(await resolveReportRunId({ listRuns: async () => [] }, "run_1", undefined, "APP")).toBe(
			"run_1",
		);
		const latest = await resolveReportRunId(
			{
				listRuns: async () => [
					{
						id: "old",
						appId: "app_1",
						deviceId: "d",
						platform: "ios",
						buildId: null,
						status: "passed",
						executionMode: "script",
						error: null,
						createdAt: 1,
						startedAt: 1,
						finishedAt: 2,
						tests: [],
					},
					{
						id: "new",
						appId: "app_1",
						deviceId: "d",
						platform: "ios",
						buildId: null,
						status: "errored",
						executionMode: "script",
						error: null,
						createdAt: 9,
						startedAt: 9,
						finishedAt: 10,
						tests: [],
					},
				],
			},
			undefined,
			"app_1",
			"APP",
		);
		expect(latest).toBe("new");
		await expect(
			resolveReportRunId({ listRuns: async () => [] }, undefined, "app_1", "APP"),
		).rejects.toThrow(/No runs found/);
	});

	test("wait status logger only emits on change", () => {
		const lines: string[] = [];
		const log = createWaitStatusLogger((message) => lines.push(message));
		const run = {
			id: "run_1",
			appId: "a",
			deviceId: "d",
			platform: "ios" as const,
			buildId: null,
			status: "queued" as const,
			executionMode: "script" as const,
			error: null,
			createdAt: 1,
			startedAt: null,
			finishedAt: null,
			tests: [],
		};
		log(run);
		log(run);
		log({ ...run, status: "running" });
		expect(lines).toEqual(["run run_1 queued", "run run_1 running"]);
	});
});

function sampleRun(overrides: Partial<Run> = {}): Run {
	return {
		id: "run_abc",
		appId: "app_1",
		deviceId: "dev_1",
		platform: "ios",
		buildId: null,
		status: "passed",
		executionMode: "script",
		error: null,
		createdAt: 1,
		startedAt: 1,
		finishedAt: 2,
		tests: [],
		...overrides,
	};
}

describe("exportCatalogRunReport", () => {
	test("writes HTML plus GitHub summary and output", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-report-"));
		const htmlPath = join(dir, "yoqa-report", "index.html");
		const summaryPath = join(dir, "summary.md");
		const outputPath = join(dir, "github-output");
		const run = sampleRun();
		const client = {
			getRun: async () => run,
			listApps: async () => [{ id: "app_1", prefix: "DEMO", name: "Demo" }],
			listCases: async () => [],
			listDevices: async () => ({ devices: [] }),
			getRunStepScreenshotUrl: () => "http://127.0.0.1/shot",
			listRuns: async () => [run],
		} as unknown as RunnerClient;

		const result = await exportCatalogRunReport(
			client,
			run.id,
			{
				baseUrl: "http://127.0.0.1:7420",
				output: htmlPath,
				githubSummary: true,
				githubOutput: true,
			},
			{
				env: { GITHUB_STEP_SUMMARY: summaryPath, GITHUB_OUTPUT: outputPath },
				fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
				log: () => undefined,
			},
		);

		expect(result.status).toBe("passed");
		expect(result.shouldFail).toBe(false);
		expect(result.outputPath).toBe(htmlPath);
		const html = await readFile(htmlPath, "utf8");
		expect(html).toContain("Yoqa Report");
		expect(html).toContain("Passed");
		const summary = await readFile(summaryPath, "utf8");
		expect(summary).toContain("**Passed**");
		expect(summary).not.toContain("data:image");
		expect(await readFile(outputPath, "utf8")).toBe(
			`run_id=${run.id}\nstatus=passed\nreport_path=${htmlPath}\n`,
		);
	});

	test("shouldFail is true only with --fail-on errored", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-report-"));
		const htmlPath = join(dir, "fail.html");
		const run = sampleRun({ status: "errored", error: "boom" });
		const client = {
			getRun: async () => run,
			listApps: async () => [],
			listCases: async () => [],
			listDevices: async () => ({ devices: [] }),
			getRunStepScreenshotUrl: () => "http://127.0.0.1/shot",
			listRuns: async () => [run],
		} as unknown as RunnerClient;

		const neverFail = await exportCatalogRunReport(
			client,
			run.id,
			{
				baseUrl: "http://127.0.0.1:7420",
				output: htmlPath,
				failOn: "never",
			},
			{ log: () => undefined },
		);
		expect(neverFail.shouldFail).toBe(false);

		const fail = await exportCatalogRunReport(
			client,
			run.id,
			{
				baseUrl: "http://127.0.0.1:7420",
				output: htmlPath,
				failOn: "errored",
			},
			{ log: () => undefined },
		);
		expect(fail.shouldFail).toBe(true);
	});
});
