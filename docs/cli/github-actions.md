# GitHub Actions HTML reports for `@yoqa/cli`

## Goal

Use `yoqa` in GitHub Actions the same way as locally: wait for a catalog run to finish, then export the **same self-contained HTML** as desktop **Export HTML**, upload it as a workflow artifact, and append a compact job summary (no embedded screenshots — Job Summary is 1MB).

## Plan summary

- Reuse `formatRunReportHtml` in `@yoqa/runner-client`. Do not generate a second HTML dialect.
- `yoqa runs create` is fire-and-forget; CI needs `--wait` (and `yoqa runs wait` / `yoqa report --wait`).
- Compact `formatRunReportGithubSummary` omits PNG data-URIs.
- Playwright-style: always write/upload the report (`--fail-on never`), then fail the job from run status.
- Composite actions live in this repo (not a separate `yoqa/setup` action repo).
- Rejected: required PR check that boots simulators; catalog-as-code in this slice.

## What shipped

**Client (`@yoqa/runner-client`)**
- `waitForRun` / `isTerminalRunStatus` / `pickLatestRun`
- `formatRunReportGithubSummary`

**CLI (`@yoqa/cli`)**
- `yoqa report [runId]` (alias of `yoqa runs report`) with `--latest`, `--wait`, `--timeout`, `--github-summary`, `--github-output`, `--fail-on never|errored`
- `yoqa runs create … --wait [--timeout] [--github-output]` — still prints the run id; exits 1 if the finished status is `errored`
- `yoqa runs wait <runId>`

**GitHub Actions**
- [`.github/actions/setup-yoqa`](../../.github/actions/setup-yoqa/action.yml) — Bun + Node + `npm i -g @yoqa/cli` + `yoqa health`
- [`.github/actions/yoqa-report`](../../.github/actions/yoqa-report/action.yml) — HTML file + artifact + job summary; optional fail after upload
- [Demo Expo E2E](./github-actions-expo.md) uploads `yoqa-expo-demo-*-report` from catalog script runs

## How to verify

```bash
bun test packages/runner-client/src/wait-for-run.test.ts packages/runner-client/src/run-report.test.ts packages/cli/src/report.test.ts packages/cli/src/github.test.ts
bun run --filter @yoqa/cli build
node packages/cli/dist/main.js report --help
node packages/cli/dist/main.js runs wait --help
```

Against a local runner with a finished catalog run:

```bash
yoqa report <runId> -o /tmp/yoqa-report.html
yoqa report --latest APP --format md -o /tmp/yoqa-report.md
```

## Follow-ups

- Catalog import/export so CI does not need a pre-seeded `~/.yoqa/yoqa.db`
- Separate public `yoqa/setup` action repo
- ZIP of raw PNGs / PDF (see [report-export.md](../runs/report-export.md))
