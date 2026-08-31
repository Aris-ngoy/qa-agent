# Show the command executing during a run

## Goal

While a catalog run executes, the run detail page should show the exact `yoqa` (or `sleep`) command behind each step, and show the command currently in flight before that step finishes.

## Plan summary

- Persist the command on each `run_steps` row and a live `run_tests.current_command` while the device action is in flight.
- Reuse inspector shell formatters (`formatActionShellLine`, `formatSleepShellLine`, `formatAssertShellLine`).
- Surface both through the existing 1s `GET /runs/:runId` poll — no SSE.
- Terminal agent decisions (`verify` / `done` / `fail`) have no device command.

Rejected for this slice: a dedicated run-event stream; changing the friendly action title (`Tap: Allow`).

## What shipped

**Client (`@yoqa/runner-client`)**
- `RunStep.command` and `RunTest.currentCommand` (optional, so older runner responses still parse)
- `formatStepCommand(action)` backfills a shell line from persisted action JSON
- Reports include `command` in HTML (`<code>`), Markdown, and GitHub summaries

**Runner**
- SQLite: `run_steps.command`, `run_tests.current_command` (migrated via `addColumnIfMissing`)
- Case executor publishes the command immediately before `performAction` / wait / assert, then clears it after the step is appended
- `GET /runs/:id` returns both fields

**Desktop**
- Run detail: monospace command under each completed step
- Live trailing row: `Executing…` plus the in-flight command, or `In progress…` while the agent is still deciding
- Inspector session reports pass the raw shell line as `command`

## How to verify

1. Start a catalog agent run and open `/runs/$id` while it is live. Confirm the last row shows `Executing…` and a `yoqa action …` line once the model has chosen an action, then that line moves into the completed list.
2. After the run finishes, each device step still shows its command; `Done` / `Verify` / `Fail` rows have none.
3. Export HTML / Markdown and confirm the command appears under the step title.
4. Unit tests: `bun test packages/runner-client/src/run-report.test.ts packages/runner-client/src/schemas.test.ts services/runner/src/domains/runs/case-executor.test.ts`

## Follow-ups

- Push run events over SSE if 1s polling misses very short actions
- Copy-to-clipboard on the command line
