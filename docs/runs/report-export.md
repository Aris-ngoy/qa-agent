# E2E report export (HTML + Markdown)

## Goal

Export a detailed end-to-end report for finished catalog runs and Manual Inspector script sessions, including pass/fail status, step details, and embedded screenshots.

## Plan summary

- Shared `RunReportDocument` model + HTML/Markdown formatters in `@yoqa/runner-client`.
- Catalog runs: client builds the report from `getRun` + step screenshot HTTP fetches.
- Inspector: capture per-step screenshots during full script runs into an ephemeral session report.
- Formats: self-contained HTML (primary) and Markdown with data-URI images.
- Rejected for v1: PDF, ZIP of raw PNGs, persisting inspector runs to SQLite, CLI `yoqa runs report`.

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

## How to verify

1. Run a catalog case → open `/runs/$id` after it finishes → Export HTML / Markdown → open the file; confirm status styling, steps, screenshots, and fail details when errored.
2. Inspector: connect a device, run a short script → Export HTML / Markdown → confirm commands, pass/fail, and screenshots match the log.
3. Cancel a catalog run mid-flight → export still works with cancelled styling.

## Follow-ups

- CLI: `yoqa runs report <id> --format html|md -o file`
- ZIP of raw PNG artifacts alongside the report
- Persist inspector sessions as catalog runs (optional)
- Export from the runs list row actions
- Post-action screenshots (catalog still stores pre-action frames)
