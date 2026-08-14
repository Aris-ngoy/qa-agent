import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	type Run,
	type RunnerClient,
	WaitForRunTimeoutError,
	buildRunReportFromCatalogRun,
	formatRunReportGithubSummary,
	formatRunReportHtml,
	formatRunReportMarkdown,
	isTerminalRunStatus,
	pickLatestRun,
	suggestedRunReportBasename,
	waitForRun,
} from "@yoqa/runner-client";
import type { Command } from "commander";
import { appendGithubFile, formatGithubOutputLines, resolveGithubWritePath } from "./github";

export const DEFAULT_RUN_WAIT_TIMEOUT_SECONDS = 1800;

export type ReportFailOn = "errored" | "never";

export type ReportCommandOptions = {
	baseUrl: string;
	format?: string;
	output?: string;
	latest?: string;
	wait?: boolean;
	timeout?: string;
	githubSummary?: boolean;
	githubOutput?: boolean;
	failOn?: string;
};

export function normalizeReportFormat(raw: string | undefined): "html" | "md" {
	const format = raw === "md" || raw === "markdown" ? "md" : (raw ?? "html");
	if (format !== "html" && format !== "md") {
		throw new Error("--format must be html or md");
	}
	return format;
}

export function parseFailOn(raw: string | undefined): ReportFailOn {
	const value = (raw ?? "never").trim().toLowerCase();
	if (value === "errored" || value === "never") return value;
	throw new Error("--fail-on must be errored or never");
}

export function parseTimeoutSeconds(
	raw: string | undefined,
	fallback = DEFAULT_RUN_WAIT_TIMEOUT_SECONDS,
): number {
	const n = raw == null || raw.trim() === "" ? fallback : Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error("--timeout must be a positive number of seconds");
	}
	return n;
}

export function shouldFailOnRunStatus(failOn: ReportFailOn, status: string): boolean {
	return failOn === "errored" && status === "errored";
}

export type ResolveReportRunIdClient = {
	listRuns: (appId: string) => Promise<Run[]>;
};

export async function resolveReportRunId(
	client: ResolveReportRunIdClient,
	runIdArg: string | undefined,
	latestAppId: string | undefined,
	latestLabel: string,
): Promise<string> {
	const runId = runIdArg?.trim();
	if (runId && latestAppId) {
		throw new Error("Pass either <runId> or --latest <app>, not both");
	}
	if (runId) return runId;
	if (!latestAppId) {
		throw new Error("Provide a run id or --latest <app>");
	}
	const latest = pickLatestRun(await client.listRuns(latestAppId));
	if (!latest) {
		throw new Error(`No runs found for app ${latestLabel}`);
	}
	return latest.id;
}

export type ExportCatalogRunReportResult = {
	outputPath: string;
	status: string;
	runId: string;
	stepCount: number;
	shouldFail: boolean;
};

export type ExportCatalogRunReportDeps = {
	fetchImpl?: typeof fetch;
	writeFile?: (path: string, data: string, encoding: "utf8") => Promise<void>;
	mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>;
	appendGithubFile?: (path: string, contents: string) => Promise<void>;
	log?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	onWaitStatus?: (run: Run) => void;
};

async function loadFinishedRun(
	client: RunnerClient,
	runId: string,
	options: ReportCommandOptions,
	deps: ExportCatalogRunReportDeps,
): Promise<Run> {
	const run = await client.getRun(runId);
	if (isTerminalRunStatus(run.status)) return run;
	if (!options.wait) {
		throw new Error(
			`Run is still ${run.status}. Wait until it finishes (passed / errored / cancelled) or pass --wait.`,
		);
	}
	const timeoutSeconds = parseTimeoutSeconds(options.timeout);
	try {
		return await waitForRun(client, runId, {
			timeoutMs: timeoutSeconds * 1000,
			onStatus: deps.onWaitStatus,
			sleep: deps.sleep,
			now: deps.now,
		});
	} catch (error) {
		if (error instanceof WaitForRunTimeoutError && error.lastRun) {
			await writeRunGithubOutput(error.lastRun, undefined, deps, options);
		}
		throw error;
	}
}

async function writeRunGithubOutput(
	run: Pick<Run, "id" | "status">,
	reportPath: string | undefined,
	deps: ExportCatalogRunReportDeps,
	options: { githubOutput?: boolean },
): Promise<void> {
	const env = deps.env ?? process.env;
	const outputPath = resolveGithubWritePath(options.githubOutput, env.GITHUB_OUTPUT, env);
	if (!outputPath) return;
	const fields: Record<string, string> = {
		run_id: run.id,
		status: run.status,
	};
	if (reportPath) fields.report_path = reportPath;
	const append = deps.appendGithubFile ?? appendGithubFile;
	await append(outputPath, formatGithubOutputLines(fields));
}

export async function exportCatalogRunReport(
	client: RunnerClient,
	runId: string,
	options: ReportCommandOptions,
	deps: ExportCatalogRunReportDeps = {},
): Promise<ExportCatalogRunReportResult> {
	const format = normalizeReportFormat(options.format);
	const failOn = parseFailOn(options.failOn);
	const env = deps.env ?? process.env;
	const log = deps.log ?? console.log;
	const write = deps.writeFile ?? writeFile;
	const makeDir = deps.mkdir ?? mkdir;
	const append = deps.appendGithubFile ?? appendGithubFile;
	const fetchImpl = deps.fetchImpl ?? fetch;

	const run = await loadFinishedRun(client, runId, options, deps);

	const screenshotsByStepId: Record<string, string> = {};
	const steps = run.tests.flatMap((test) => test.steps ?? []);
	await Promise.all(
		steps.map(async (step) => {
			if (!step.screenshotUri) return;
			const response = await fetchImpl(client.getRunStepScreenshotUrl(run.id, step.id));
			if (!response.ok) return;
			const bytes = new Uint8Array(await response.arrayBuffer());
			screenshotsByStepId[step.id] = Buffer.from(bytes).toString("base64");
		}),
	);

	const apps = await client.listApps();
	const app = apps.find((row) => row.id === run.appId);
	const cases = await client.listCases(run.appId);
	const caseTitles: Record<string, string> = {};
	for (const item of cases) {
		caseTitles[item.id] = `#${item.number} ${item.name}`;
	}

	let deviceLabel: string | null = run.deviceId;
	try {
		const devices = await client.listDevices(run.platform, { includeUnavailable: true });
		const device = devices.devices.find((row) => row.id === run.deviceId);
		if (device) {
			deviceLabel = `${device.name} · ${run.platform} ${device.osVersion}`;
		}
	} catch {
		/* device lookup optional */
	}

	const doc = buildRunReportFromCatalogRun(
		run,
		{
			appLabel: app ? `${app.prefix} — ${app.name}` : run.appId,
			deviceLabel,
			caseTitles,
		},
		screenshotsByStepId,
	);

	const contents = format === "html" ? formatRunReportHtml(doc) : formatRunReportMarkdown(doc);
	const extension = format === "html" ? "html" : "md";
	const outputPath = options.output?.trim() || `${suggestedRunReportBasename(doc)}.${extension}`;
	await makeDir(dirname(outputPath), { recursive: true });
	await write(outputPath, contents, "utf8");
	log(`wrote ${outputPath} (${doc.status}, ${steps.length} steps)`);

	const summaryPath = resolveGithubWritePath(options.githubSummary, env.GITHUB_STEP_SUMMARY, env);
	if (summaryPath) {
		await append(summaryPath, formatRunReportGithubSummary(doc));
	}

	await writeRunGithubOutput(run, outputPath, { ...deps, env, appendGithubFile: append }, options);

	return {
		outputPath,
		status: doc.status,
		runId: run.id,
		stepCount: steps.length,
		shouldFail: shouldFailOnRunStatus(failOn, doc.status),
	};
}

export function attachReportCommandOptions(cmd: Command): Command {
	return cmd
		.argument("[runId]", "Run id")
		.option("--latest <app>", "Export the newest run for this app prefix or id")
		.option("--format <format>", "html | md (default: html)", "html")
		.option("-o, --output <path>", "Output file path (default: yoqa-run-<id>-<status>.html|md)")
		.option("--wait", "Wait until the run finishes before exporting")
		.option(
			"--timeout <seconds>",
			"Wait timeout in seconds (default: 1800)",
			String(DEFAULT_RUN_WAIT_TIMEOUT_SECONDS),
		)
		.option("--github-summary", "Append compact markdown to $GITHUB_STEP_SUMMARY")
		.option("--no-github-summary", "Do not write a GitHub job summary")
		.option("--github-output", "Write run_id, status, report_path to $GITHUB_OUTPUT")
		.option("--no-github-output", "Do not write GitHub step outputs")
		.option("--fail-on <when>", "errored | never (default: never)", "never");
}

export type WaitProgressLogger = (message: string) => void;

export function createWaitStatusLogger(
	write: WaitProgressLogger = console.error,
): (run: Run) => void {
	let last = "";
	return (run) => {
		if (run.status === last) return;
		last = run.status;
		write(`run ${run.id} ${run.status}`);
	};
}

export async function maybeWriteGithubRunOutput(
	run: Pick<Run, "id" | "status">,
	flag: boolean | undefined,
	env: NodeJS.ProcessEnv = process.env,
	append: (path: string, contents: string) => Promise<void> = appendGithubFile,
): Promise<void> {
	const outputPath = resolveGithubWritePath(flag, env.GITHUB_OUTPUT, env);
	if (!outputPath) return;
	await append(outputPath, formatGithubOutputLines({ run_id: run.id, status: run.status }));
}

export function attachGithubOutputOptions(cmd: Command): Command {
	return cmd
		.option("--github-output", "Write run_id and status to $GITHUB_OUTPUT")
		.option("--no-github-output", "Do not write GitHub step outputs");
}

export function attachWaitOptions(cmd: Command): Command {
	return attachGithubOutputOptions(
		cmd
			.option("--wait", "Wait until the run finishes (passed / errored / cancelled)")
			.option(
				"--timeout <seconds>",
				"Wait timeout in seconds (default: 1800)",
				String(DEFAULT_RUN_WAIT_TIMEOUT_SECONDS),
			),
	);
}
