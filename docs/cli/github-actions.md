# GitHub Actions HTML reports for `@yoqa/cli`

## Goal

Use `yoqa` in GitHub Actions the same way as locally: wait for a catalog run to finish, then export the **same self-contained HTML** as desktop **Export HTML**, upload it as a workflow artifact, and append a [Job Summary](../../CONTEXT.md) that is the [Run report](../../CONTEXT.md) in text form: every Test Case's steps, the failed steps, and a link straight to the uploaded artifact (no embedded screenshots — GitHub caps a step's Job Summary at 1 MiB and does not render data-URI images). Spec: [#468](https://github.com/Aris-ngoy/qa-agent/issues/468).

## Plan summary

- Reuse `formatRunReportHtml` in `@yoqa/runner-client`. Do not generate a second HTML dialect.
- `yoqa runs create` is fire-and-forget; CI needs `--wait` (and `yoqa runs wait` / `yoqa report --wait`).
- `formatRunReportGithubSummary(doc, { reportUrl?, maxBytes? })` is the single Job Summary renderer: one `<details>` block per Test Case (failed and cancelled start open), the Failed steps list near the top, and no `thoughts`, phases or screenshots. Over ~900 KiB it drops passing Test Cases' blocks, then falls back to the compact form, and says it trimmed.
- The action writes the Job Summary **after** the upload, because the artifact link only exists then. `yoqa report --summary-only` makes that second call cheap: no screenshot fetches, no report file, no GitHub outputs. `--report-url` takes any URL, so other CI systems can point the footer at their own storage.
- Rejected: a compact/detailed switch flag, a merged cross-platform summary job, inline screenshots (would need hosting outside GitHub artifacts).
- Playwright-style: always write/upload the report (`--fail-on never`), then fail the job from run status.
- Composite actions live in this repo (not a separate `yoqa/setup` action repo).
- Rejected: required PR check that boots simulators; catalog-as-code in this slice.

## What shipped

**Client (`@yoqa/runner-client`)**
- `waitForRun` / `isTerminalRunStatus` / `pickLatestRun`
- `formatRunReportGithubSummary(doc, { reportUrl?, maxBytes? })` — detailed per-Test Case blocks, size guard, footer link to `reportUrl` (generic "download the artifact" line without one)

**CLI (`@yoqa/cli`)**
- `yoqa report [runId]` (alias of `yoqa runs report`) with `--latest`, `--wait`, `--timeout`, `--github-summary`, `--github-output`, `--fail-on never|errored`
- `yoqa report --report-url <url>` — the Job Summary footer links to the uploaded Run report
- `yoqa report --summary-only` — appends only the Job Summary (implies `--github-summary`; needs `$GITHUB_STEP_SUMMARY`); fetches no screenshots, writes no report file and no `$GITHUB_OUTPUT`
- `yoqa runs create … --wait [--timeout] [--github-output]` — still prints the run id; exits 1 if the finished status is `errored`
- `yoqa runs wait <runId>`

**GitHub Actions**
- [`.github/actions/setup-yoqa`](../../.github/actions/setup-yoqa/action.yml) — Bun + Node + `npm i -g @yoqa/cli` + `yoqa health`
- [`.github/actions/yoqa-report`](../../.github/actions/yoqa-report/action.yml) — export the HTML with `--no-github-summary --github-output` → upload the artifact (step id `upload`) → `yoqa report <run-id> --summary-only --report-url <artifact-url>` → optional fail on `errored`. Inputs, outputs and `base-url` handling are unchanged, so callers need no edits
- [Demo Expo E2E](./github-actions-expo.md) uploads `yoqa-expo-demo-*-report` from catalog script runs, and now also triggers on `.github/actions/yoqa-report/**` so action changes are exercised on their own PR

## How to verify

```bash
bun test packages/runner-client/src/wait-for-run.test.ts packages/runner-client/src/run-report.test.ts packages/cli/src/report.test.ts packages/cli/src/github.test.ts
bun run --filter @yoqa/cli build
node packages/cli/dist/main.js report --help
node packages/cli/dist/main.js runs wait --help
```

Job Summary without uploading anything (any finished Run):

```bash
GITHUB_STEP_SUMMARY=/tmp/summary.md yoqa report <runId> --summary-only --report-url https://example.test/report
cat /tmp/summary.md   # one <details> block per Test Case, footer links to the URL; no file is written
```

In CI: the PR's Demo Expo E2E run shows each platform job's Job Summary with every Test Case's steps and a "Full Run report with screenshots" link to that job's artifact.

Against a local runner with a finished catalog run:

```bash
yoqa report <runId> -o /tmp/yoqa-report.html
yoqa report --latest APP --format md -o /tmp/yoqa-report.md
```

## Follow-ups

- Catalog import/export so CI does not need a pre-seeded `~/.yoqa/yoqa.db`
- Separate public `yoqa/setup` action repo
- ZIP of raw PNGs / PDF (see [report-export.md](../runs/report-export.md))
- Job Summary: none planned; inline screenshots and a combined cross-platform summary are out of scope (#468)
