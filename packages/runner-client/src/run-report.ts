import type { Run, RunStatus, RunStep, RunTestStatus } from "./schemas";

export type RunReportStatus = "passed" | "errored" | "cancelled";

export type RunReportStep = {
	id: string;
	index: number;
	/** Short label, e.g. "Tap" or shell command text. */
	summary: string;
	ok: boolean;
	latencyMs: number | null;
	detail: string | null;
	reason: string | null;
	thoughts: string | null;
	/** Raw PNG bytes as base64 (no data-URI prefix). */
	screenshotBase64: string | null;
};

export type RunReportTest = {
	id: string;
	title: string;
	status: RunTestStatus;
	executionMode: "script" | "agent" | null;
	error: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	steps: RunReportStep[];
};

export type RunReportDocument = {
	id: string;
	source: "catalog" | "inspector";
	status: RunReportStatus;
	title: string;
	appLabel: string | null;
	deviceLabel: string | null;
	platform: string | null;
	executionMode: string | null;
	error: string | null;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
	tests: RunReportTest[];
};

export type CatalogRunReportMeta = {
	appLabel?: string | null;
	deviceLabel?: string | null;
	/** caseId → display title */
	caseTitles?: Record<string, string>;
};

export type InspectorRunReportInput = {
	id?: string;
	title?: string;
	appLabel?: string | null;
	deviceLabel?: string | null;
	platform?: string | null;
	ok: boolean;
	cancelled?: boolean;
	error?: string | null;
	startedAt: number;
	finishedAt: number;
	steps: Array<{
		id?: string;
		index: number;
		summary: string;
		ok: boolean;
		latencyMs?: number | null;
		detail?: string | null;
		screenshotBase64?: string | null;
	}>;
};

export function actionSummary(action: unknown): string {
	if (!action || typeof action !== "object") return "Step";
	const record = action as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : "step";
	if (type === "tap") return "Tap";
	if (type === "type") return `Type${typeof record.text === "string" ? `: ${record.text}` : ""}`;
	if (type === "wait") return "Wait";
	if (type === "verify") return "Verify";
	if (type === "done") return "Done";
	if (type === "fail") return "Failed";
	if (type === "swipe") return "Swipe";
	if (type === "input") {
		return `Input${typeof record.text === "string" ? `: ${record.text}` : ""}`;
	}
	return type.charAt(0).toUpperCase() + type.slice(1);
}

export function stepReasoning(step: {
	action?: unknown;
	detail: string | null;
}): { reason: string | null; thoughts: string | null } {
	const action =
		step.action && typeof step.action === "object"
			? (step.action as Record<string, unknown>)
			: null;
	const reasonFromAction =
		typeof action?.reason === "string" && action.reason.trim() ? action.reason.trim() : null;
	const thoughtsFromAction =
		typeof action?.thoughts === "string" && action.thoughts.trim() ? action.thoughts.trim() : null;
	const reason = reasonFromAction ?? (step.detail?.trim() ? step.detail.trim() : null);
	const thoughts = thoughtsFromAction && thoughtsFromAction !== reason ? thoughtsFromAction : null;
	return { reason, thoughts };
}

function toReportStatus(status: RunStatus): RunReportStatus | null {
	if (status === "passed" || status === "errored" || status === "cancelled") return status;
	return null;
}

function mapCatalogStep(step: RunStep, screenshotsByStepId: Record<string, string>): RunReportStep {
	const { reason, thoughts } = stepReasoning(step);
	return {
		id: step.id,
		index: step.idx + 1,
		summary: actionSummary(step.action),
		ok: step.ok,
		latencyMs: step.latencyMs,
		detail: step.detail,
		reason,
		thoughts,
		screenshotBase64: screenshotsByStepId[step.id] ?? null,
	};
}

export function buildRunReportFromCatalogRun(
	run: Run,
	meta: CatalogRunReportMeta = {},
	screenshotsByStepId: Record<string, string> = {},
): RunReportDocument {
	const status = toReportStatus(run.status);
	if (!status) {
		throw new Error(`Cannot export report for live run status: ${run.status}`);
	}

	const caseTitles = meta.caseTitles ?? {};
	const tests: RunReportTest[] = run.tests.map((test) => ({
		id: test.id,
		title: caseTitles[test.caseId] ?? test.caseId,
		status: test.status,
		executionMode: test.executionMode ?? null,
		error: test.error,
		startedAt: test.startedAt,
		finishedAt: test.finishedAt,
		steps: (test.steps ?? []).map((step) => mapCatalogStep(step, screenshotsByStepId)),
	}));

	const primaryTitle = tests[0]?.title ?? "Run";

	return {
		id: run.id,
		source: "catalog",
		status,
		title: primaryTitle,
		appLabel: meta.appLabel ?? null,
		deviceLabel: meta.deviceLabel ?? null,
		platform: run.platform,
		executionMode: run.executionMode,
		error: run.error,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		tests,
	};
}

export function buildRunReportFromInspectorSession(
	input: InspectorRunReportInput,
): RunReportDocument {
	const status: RunReportStatus = input.cancelled ? "cancelled" : input.ok ? "passed" : "errored";
	const id = input.id ?? `inspector-${input.startedAt}`;
	const steps: RunReportStep[] = input.steps.map((step) => ({
		id: step.id ?? `step-${step.index}`,
		index: step.index,
		summary: step.summary,
		ok: step.ok,
		latencyMs: step.latencyMs ?? null,
		detail: step.detail ?? null,
		reason: step.detail ?? null,
		thoughts: null,
		screenshotBase64: step.screenshotBase64 ?? null,
	}));

	return {
		id,
		source: "inspector",
		status,
		title: input.title?.trim() || "Inspector session",
		appLabel: input.appLabel ?? null,
		deviceLabel: input.deviceLabel ?? null,
		platform: input.platform ?? null,
		executionMode: "manual",
		error: input.error ?? null,
		createdAt: input.startedAt,
		startedAt: input.startedAt,
		finishedAt: input.finishedAt,
		tests: [
			{
				id: `${id}-test`,
				title: input.title?.trim() || "Inspector script",
				status,
				executionMode: null,
				error: input.error ?? null,
				startedAt: input.startedAt,
				finishedAt: input.finishedAt,
				steps,
			},
		],
	};
}

export function suggestedRunReportBasename(doc: RunReportDocument): string {
	const shortId = doc.id.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 8) || "run";
	const raw = ["yoqa-run", shortId, doc.status]
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return raw || "yoqa-run-report";
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function formatWhen(ms: number | null): string {
	if (ms == null) return "—";
	return new Date(ms).toLocaleString();
}

function formatDuration(startedAt: number | null, finishedAt: number | null): string {
	if (startedAt == null || finishedAt == null) return "—";
	const ms = Math.max(0, finishedAt - startedAt);
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	return `${minutes}m ${rem}s`;
}

function statusAccent(status: RunReportStatus): { bg: string; fg: string; label: string } {
	if (status === "passed") {
		return { bg: "#dcfce7", fg: "#166534", label: "Passed" };
	}
	if (status === "errored") {
		return { bg: "#fee2e2", fg: "#991b1b", label: "Failed" };
	}
	return { bg: "#e5e7eb", fg: "#374151", label: "Cancelled" };
}

function pngDataUri(base64: string): string {
	return `data:image/png;base64,${base64}`;
}

export function formatRunReportHtml(doc: RunReportDocument): string {
	const accent = statusAccent(doc.status);
	const metaRows: Array<[string, string]> = [
		["Status", accent.label],
		["Source", doc.source === "catalog" ? "Catalog run" : "Manual Inspector"],
		["App", doc.appLabel ?? "—"],
		["Device", doc.deviceLabel ?? "—"],
		["Platform", doc.platform ?? "—"],
		["Mode", doc.executionMode ?? "—"],
		["Started", formatWhen(doc.startedAt ?? doc.createdAt)],
		["Finished", formatWhen(doc.finishedAt)],
		["Duration", formatDuration(doc.startedAt ?? doc.createdAt, doc.finishedAt)],
		["Run ID", doc.id],
	];

	const testsHtml = doc.tests
		.map((test, testIndex) => {
			const testAccent = statusAccent(
				test.status === "passed" || test.status === "errored" || test.status === "cancelled"
					? test.status
					: doc.status,
			);
			const stepsHtml = test.steps
				.map((step) => {
					const stepStatus = step.ok ? "Passed" : "Failed";
					const stepColor = step.ok ? "#166534" : "#991b1b";
					const reasonBlock = step.reason ? `<p class="reason">${escapeHtml(step.reason)}</p>` : "";
					const thoughtsBlock = step.thoughts
						? `<details class="thoughts"><summary>AI thoughts</summary><p>${escapeHtml(step.thoughts)}</p></details>`
						: "";
					const detailBlock =
						step.detail && step.detail !== step.reason
							? `<p class="detail">${escapeHtml(step.detail)}</p>`
							: "";
					const shot = step.screenshotBase64
						? `<img class="shot" alt="Step ${step.index} screenshot" src="${pngDataUri(step.screenshotBase64)}" />`
						: `<p class="muted">No screenshot</p>`;
					const latency =
						step.latencyMs != null ? `<span class="muted">${step.latencyMs}ms</span>` : "";
					return `
<article class="step ${step.ok ? "ok" : "fail"}">
  <header>
    <span class="idx">${step.index}</span>
    <div>
      <h3>${escapeHtml(step.summary)}</h3>
      <p class="step-status" style="color:${stepColor}">${stepStatus} ${latency}</p>
    </div>
  </header>
  ${reasonBlock}
  ${detailBlock}
  ${thoughtsBlock}
  ${shot}
</article>`;
				})
				.join("\n");

			return `
<section class="test">
  <h2>
    <span class="test-num">${testIndex + 1}</span>
    ${escapeHtml(test.title)}
    <span class="pill" style="background:${testAccent.bg};color:${testAccent.fg}">${escapeHtml(testAccent.label)}</span>
  </h2>
  ${test.error ? `<p class="error">${escapeHtml(test.error)}</p>` : ""}
  ${test.executionMode ? `<p class="muted">Mode: ${escapeHtml(test.executionMode)}</p>` : ""}
  <div class="steps">${stepsHtml || `<p class="muted">No steps recorded</p>`}</div>
</section>`;
		})
		.join("\n");

	const metaHtml = metaRows
		.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yoqa Report — ${escapeHtml(doc.title)} (${escapeHtml(accent.label)})</title>
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; line-height: 1.5; }
  .wrap { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .banner { border-radius: 1rem; padding: 1.25rem 1.5rem; background: ${accent.bg}; color: ${accent.fg}; margin-bottom: 1.5rem; }
  .banner h1 { margin: 0 0 0.35rem; font-size: 1.5rem; }
  .banner p { margin: 0; opacity: 0.9; }
  table.meta { width: 100%; border-collapse: collapse; background: #fff; border-radius: 0.75rem; overflow: hidden; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); margin-bottom: 2rem; }
  table.meta th, table.meta td { text-align: left; padding: 0.65rem 1rem; border-bottom: 1px solid #e2e8f0; font-size: 0.9rem; }
  table.meta th { width: 8rem; color: #64748b; font-weight: 600; }
  .error { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 0.5rem; }
  .test { margin-bottom: 2.5rem; }
  .test h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 1.15rem; }
  .test-num { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 999px; background: #0f172a; color: #fff; font-size: 0.8rem; }
  .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.15rem 0.65rem; font-size: 0.75rem; font-weight: 600; }
  .step { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1rem; margin: 0.75rem 0; }
  .step.fail { border-color: #fecaca; }
  .step header { display: flex; gap: 0.75rem; align-items: flex-start; }
  .step .idx { flex-shrink: 0; width: 1.75rem; height: 1.75rem; border-radius: 999px; background: #e2e8f0; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; }
  .step.ok .idx { background: #bbf7d0; color: #166534; }
  .step.fail .idx { background: #fecaca; color: #991b1b; }
  .step h3 { margin: 0; font-size: 1rem; }
  .step-status { margin: 0.15rem 0 0; font-size: 0.8rem; font-weight: 600; }
  .reason, .detail { margin: 0.5rem 0 0; color: #475569; font-size: 0.9rem; }
  .thoughts { margin-top: 0.5rem; font-size: 0.85rem; color: #64748b; }
  .thoughts p { margin: 0.35rem 0 0; white-space: pre-wrap; }
  .shot { display: block; max-width: 100%; width: min(22rem, 100%); margin-top: 0.75rem; border-radius: 0.75rem; border: 1px solid #e2e8f0; }
  .muted { color: #94a3b8; font-size: 0.85rem; }
  footer { margin-top: 2rem; color: #94a3b8; font-size: 0.8rem; }
  @media print {
    body { background: #fff; }
    .shot { max-height: 60vh; object-fit: contain; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="banner">
      <h1>${escapeHtml(doc.title)}</h1>
      <p>${escapeHtml(accent.label)} · Yoqa end-to-end report</p>
    </header>
    ${doc.error ? `<p class="error">${escapeHtml(doc.error)}</p>` : ""}
    <table class="meta">${metaHtml}</table>
    ${testsHtml}
    <footer>Generated by Yoqa</footer>
  </div>
</body>
</html>
`;
}

function escapeMd(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatRunReportMarkdown(doc: RunReportDocument): string {
	const accent = statusAccent(doc.status);
	const lines: string[] = [
		`# Yoqa Report — ${doc.title}`,
		"",
		`**Status:** ${accent.label}`,
		"",
		"| Field | Value |",
		"| --- | --- |",
		`| Source | ${doc.source === "catalog" ? "Catalog run" : "Manual Inspector"} |`,
		`| App | ${escapeMd(doc.appLabel ?? "—")} |`,
		`| Device | ${escapeMd(doc.deviceLabel ?? "—")} |`,
		`| Platform | ${escapeMd(doc.platform ?? "—")} |`,
		`| Mode | ${escapeMd(doc.executionMode ?? "—")} |`,
		`| Started | ${escapeMd(formatWhen(doc.startedAt ?? doc.createdAt))} |`,
		`| Finished | ${escapeMd(formatWhen(doc.finishedAt))} |`,
		`| Duration | ${escapeMd(formatDuration(doc.startedAt ?? doc.createdAt, doc.finishedAt))} |`,
		`| Run ID | \`${doc.id}\` |`,
		"",
	];

	if (doc.error) {
		lines.push(`> **Error:** ${doc.error}`, "");
	}

	doc.tests.forEach((test, testIndex) => {
		const testLabel =
			test.status === "passed"
				? "Passed"
				: test.status === "errored"
					? "Failed"
					: test.status === "cancelled"
						? "Cancelled"
						: test.status;
		lines.push(`## ${testIndex + 1}. ${test.title} (${testLabel})`, "");
		if (test.executionMode) lines.push(`Mode: \`${test.executionMode}\``, "");
		if (test.error) lines.push(`**Error:** ${test.error}`, "");
		if (test.steps.length === 0) {
			lines.push("_No steps recorded_", "");
			return;
		}
		for (const step of test.steps) {
			lines.push(`### Step ${step.index}: ${step.summary}`);
			lines.push("");
			lines.push(`- Result: **${step.ok ? "Passed" : "Failed"}**`);
			if (step.latencyMs != null) lines.push(`- Latency: ${step.latencyMs}ms`);
			if (step.reason) lines.push(`- Reason: ${step.reason}`);
			if (step.detail && step.detail !== step.reason) lines.push(`- Detail: ${step.detail}`);
			if (step.thoughts) {
				lines.push(
					"",
					"<details><summary>AI thoughts</summary>",
					"",
					step.thoughts,
					"",
					"</details>",
				);
			}
			if (step.screenshotBase64) {
				lines.push("", `![Step ${step.index} screenshot](${pngDataUri(step.screenshotBase64)})`);
			} else {
				lines.push("", "_No screenshot_");
			}
			lines.push("");
		}
	});

	lines.push("---", "", "_Generated by Yoqa_", "");
	return lines.join("\n");
}

/**
 * Compact Markdown for GitHub Job Summaries. Omits screenshots (Job Summary is 1MB).
 */
export function formatRunReportGithubSummary(doc: RunReportDocument): string {
	const accent = statusAccent(doc.status);
	const passed = doc.tests.filter((test) => test.status === "passed").length;
	const failed = doc.tests.filter((test) => test.status === "errored").length;
	const cancelled = doc.tests.filter((test) => test.status === "cancelled").length;
	const failedSteps = doc.tests.flatMap((test) =>
		test.steps.filter((step) => !step.ok).map((step) => ({ test, step })),
	);

	const lines: string[] = [
		`## Yoqa Report — ${doc.title}`,
		"",
		`**${accent.label}** · ${doc.tests.length} test${doc.tests.length === 1 ? "" : "s"} · ${passed} passed · ${failed} failed · ${cancelled} cancelled`,
		"",
		"| Field | Value |",
		"| --- | --- |",
		`| App | ${escapeMd(doc.appLabel ?? "—")} |`,
		`| Device | ${escapeMd(doc.deviceLabel ?? "—")} |`,
		`| Platform | ${escapeMd(doc.platform ?? "—")} |`,
		`| Mode | ${escapeMd(doc.executionMode ?? "—")} |`,
		`| Duration | ${escapeMd(formatDuration(doc.startedAt ?? doc.createdAt, doc.finishedAt))} |`,
		`| Run ID | \`${doc.id}\` |`,
		"",
	];

	if (doc.error) {
		lines.push(`> **Error:** ${doc.error}`, "");
	}

	if (doc.tests.length > 0) {
		lines.push("### Tests", "", "| # | Test | Status | Steps |", "| --- | --- | --- | --- |");
		doc.tests.forEach((test, testIndex) => {
			const testLabel =
				test.status === "passed"
					? "Passed"
					: test.status === "errored"
						? "Failed"
						: test.status === "cancelled"
							? "Cancelled"
							: test.status;
			lines.push(
				`| ${testIndex + 1} | ${escapeMd(test.title)} | ${testLabel} | ${test.steps.length} |`,
			);
		});
		lines.push("");
	}

	if (failedSteps.length > 0) {
		lines.push("### Failed steps", "");
		for (const { test, step } of failedSteps) {
			lines.push(`- **${escapeMd(test.title)}** · step ${step.index}: ${escapeMd(step.summary)}`);
			if (step.reason) lines.push(`  - Reason: ${escapeMd(step.reason)}`);
			if (step.detail && step.detail !== step.reason) {
				lines.push(`  - Detail: ${escapeMd(step.detail)}`);
			}
		}
		lines.push("");
	}

	lines.push("Download the `yoqa-report` artifact for the full HTML report with screenshots.", "");
	return lines.join("\n");
}
