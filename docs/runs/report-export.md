# E2E report export (HTML + Markdown)

## Goal

Export a detailed end-to-end report for finished catalog runs and Manual Inspector script sessions, including pass/fail status, step details, and embedded screenshots.

## Plan summary

- Shared `RunReportDocument` model + HTML/Markdown formatters in `@yoqa/runner-client`.
- Catalog runs: client builds the report from `getRun` + step screenshot HTTP fetches.
- Inspector: capture per-step screenshots during full script runs into an ephemeral session report.
- Formats: self-contained HTML (primary) and Markdown with data-URI images.
- CLI: `yoqa runs report <runId>` writes the same report to disk.
- Deferred: PDF, ZIP of raw PNGs, persisting inspector runs to SQLite.

## What shipped

**Client (`@yoqa/runner-client`)**
- `buildRunReportFromCatalogRun` / `buildRunReportFromInspectorSession`
- `formatRunReportHtml` / `formatRunReportMarkdown` / `suggestedRunReportBasename`
- Shared `actionSummary` / `stepReasoning` helpers

**Desktop — catalog Runs**
- Run detail page: **Export HTML** / **Export Markdown** when status is `passed` / `errored` / `cancelled`
- Embeds step PNGs from `GET /runs/:id/steps/:stepId/screenshot`

**Desktop — Inspector**
- Full **Run script** captures step screenshots into a session report
- **Export HTML** / **Export Markdown** on the run panel (enabled after a finished script run)
- Existing **Export .sh** unchanged

**CLI**
- `yoqa runs report <runId> [--format html|md] [-o path]` — embeds screenshots; defaults to `yoqa-run-<id>-<status>.html`

## How to verify

1. Run a catalog case → open `/runs/$id` after it finishes → Export HTML / Markdown → open the file; confirm status styling, steps, screenshots, and fail details when errored.
2. Inspector: connect a device, run a short script → Export HTML / Markdown → confirm commands, pass/fail, and screenshots match the log.
3. Cancel a catalog run mid-flight → export still works with cancelled styling.
4. CLI: `yoqa runs report <runId> --format html` and `--format md -o ./report.md`; open the files and confirm screenshots + status.

## Follow-ups

- ZIP of raw PNG artifacts alongside the report
- Persist inspector sessions as catalog runs (optional)
- Export from the runs list row actions
- Post-action screenshots (catalog still stores pre-action frames)
