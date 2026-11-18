# E2E report export (HTML + Markdown)

## Goal

Export a detailed end-to-end report for finished catalog runs and Manual Inspector script sessions, including pass/fail status, step details, and embedded screenshots.

## Plan summary

- Shared `RunReportDocument` model + HTML/Markdown formatters in `@yoqa/runner-client`.
- Catalog runs: client builds the report from `getRun` + step screenshot HTTP fetches.
- Inspector: capture per-step screenshots during full script runs into an ephemeral session report.
- Formats: self-contained HTML (primary) and Markdown with data-URI images.
- CLI: `yoqa runs report <runId>` writes the same report to disk.
- CLI (CI): `yoqa report` / `--wait` / GitHub Job Summary — see [github-actions.md](../cli/github-actions.md).
- Job Summary ([#468](https://github.com/Aris-ngoy/qa-agent/issues/468)): the text-only form of the Run report — every Test Case's steps in a collapsible block, a link to the uploaded report, no screenshots. `--summary-only` writes it without re-fetching screenshots or rewriting the report file; the HTML and Markdown exports are unchanged.
- Deferred: PDF, ZIP of raw PNGs, persisting inspector runs to SQLite.

## What shipped

**Client (`@yoqa/runner-client`)**
- `buildRunReportFromCatalogRun` / `buildRunReportFromInspectorSession`
- `formatRunReportHtml` / `formatRunReportMarkdown` / `formatRunReportGithubSummary(doc, { reportUrl?, maxBytes? })` / `suggestedRunReportBasename`
- Shared `actionSummary` / `stepReasoning` helpers

**Desktop — catalog Runs**
- Run detail page: **Export HTML** / **Export Markdown** when status is `passed` / `errored` / `cancelled`
- Embeds step PNGs from `GET /runs/:id/steps/:stepId/screenshot`

**Desktop — Inspector**
- Full **Run script** captures step screenshots into a session report
- **Export HTML** / **Export Markdown** on the run panel (enabled after a finished script run)
- Existing **Export .sh** unchanged

**CLI**
- `yoqa report [runId]` / `yoqa runs report` — same HTML/Markdown as desktop; `--latest`, `--wait`, `--github-summary`, `--github-output`, `--fail-on never|errored`
- `--report-url <url>` links the Job Summary footer to the stored Run report; `--summary-only` appends only the Job Summary (no screenshot fetches, no report file, no GitHub outputs)
- Defaults to `yoqa-run-<id>-<status>.html`

## How to verify

1. Run a catalog case → open `/runs/$id` after it finishes → Export HTML / Markdown → open the file; confirm status styling, steps, screenshots, and fail details when errored.
2. Inspector: connect a device, run a short script → Export HTML / Markdown → confirm commands, pass/fail, and screenshots match the log.
3. Cancel a catalog run mid-flight → export still works with cancelled styling.
4. CLI: `yoqa report <runId>` and `yoqa runs report <runId> --format md -o ./report.md`; open the files and confirm screenshots + status.
5. CI helpers: `bun test packages/cli/src/report.test.ts packages/runner-client/src/run-report.test.ts`.
6. Job Summary: `GITHUB_STEP_SUMMARY=/tmp/summary.md yoqa report <runId> --summary-only --report-url https://example.test/r` → `/tmp/summary.md` has a `<details>` block per Test Case and a "Full Run report with screenshots" link; no report file appears.

## Follow-ups

- ZIP of raw PNG artifacts alongside the report
- Persist inspector sessions as catalog runs (optional)
- Export from the runs list row actions
- Post-action screenshots (catalog still stores pre-action frames)
