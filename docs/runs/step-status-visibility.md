# Run detail: per-step status visibility

## Goal

Give live runs clearer tracing by showing Completed / Failed on each recorded step, plus an In progress… signal while the case is still running — not only at the case header.

## Plan summary

- UI-only change on the run detail stepper.
- Steps are appended after each action finishes (`ok` boolean only), so do not pretend the latest recorded step is still executing.
- Live: green `Completed` / red `Failed` under each step; trailing muted `…` row with `In progress…` while the test is `queued` or `running`.
- Review: keep check/X indicators and `Passed` / `Failed` labels.

Rejected: marking the last recorded step as in progress; backend step-status enum.

## What shipped

**Desktop**
- [`detail-page.tsx`](../../apps/desktop/src/mainview/features/runs/detail-page.tsx) — `StepStatusLabel`, `InProgressStepRow`; live steps show Completed/Failed; trailing In progress… while the case is live; empty finished tests still show “No steps recorded”

## How to verify

1. Start a live run: finished steps show green **Completed** (or red **Failed**), and a trailing **In progress…** row stays until the case finishes.
2. When the run ends, review mode still shows check/X + Passed/Failed; step selection and screenshots still work.
3. A queued/empty live case shows a single **In progress…** row instead of a blank list.

## Follow-ups

- none
