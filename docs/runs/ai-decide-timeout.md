# Keep runs visible during AI decide (and fail fast when the provider hangs)

## Goal

A live agent run could sit on "In progress…" with zero steps and an empty screenshot panel
while the vision decide call was still in flight — and if the provider CLI never returned,
the run stayed `running` forever (only a manual Stop got out). Reproduced as run
`run_30eb853d` (screenshot: `#1 Check Navigation`, 0 steps, cancelled at 57s).

## Plan summary

- The decide call is the only long phase with `current_command = null` (Argent calls have
  120s timeouts that *throw*; steps are appended only after a decision is applied), so
  publish a live label during it — reuse the existing `run_tests.current_command` poll.
- Give one decide attempt a hard budget (`DECIDE_TIMEOUT_MS = 300s`, above the
  worst legitimate CLI path of 2×130s with JSON-repair retry) so a hung provider fails the
  step instead of freezing the run. The budget is per attempt: `decideOnce` may retry
  once on an absurd no-screenshot fail, so a step with two slow-but-working attempts
  can take up to ~2× the budget.
- Fix the shared subprocess bug: both `runCommand` and `runArgentBin` killed the child at
  the deadline but still awaited pipe EOF — a grandchild inheriting stdout/stderr keeps the
  pipes open forever. Race the deadline against the reads; return partial output.
- Antigravity's `agy --print-timeout` partial output is not valid JSON and is *not* worth a
  repair retry (it would wait another full ~130s for the same slow turn — the 253s failure
  seen at 00:41). Map it to a non-repairable provider error so the run fails fast.

Rejected: an SSE event stream (the 1s `GET /runs/:id` poll already carries
`currentCommand`); a run-level watchdog across all phases (left as follow-up).

## What shipped

**Runner — `services/runner/src/domains/runs/`**
- `case-executor.ts`: exports `AI_DECIDING_COMMAND` ("AI deciding next action…") and
  `DECIDE_TIMEOUT_MS` (300s per decide attempt); each `decide` attempt inside
  `decideOnce` — including the absurd-no-screenshot retry — runs under its own
  `withDecideTimeout` budget, so two slow-but-working attempts (up to ~2×260s)
  don't trip a single outer timer. Both `decideGuarded` call sites (first attempt
  + action-retry) wrap that in `withCurrentCommand(AI_DECIDING_COMMAND, …)`;
  new optional `AgentCaseDeps.decideTimeoutMs` for tests. The guard frees the
  run, not the process: a hung child keeps running until the OS reaps it.

**Runner — `services/runner/src/domains/providers/`**
- `drivers/probe.ts`: `runCommand` now drains pipes incrementally, races the deadline
  against them, kills + grace-drains on timeout, and returns partial output with
  `timedOut: true` / `exitCode: 124` (stderr gains a `Command timed out after …ms`
  suffix). Exports the shared `CommandResult` envelope type.
- `drivers/antigravity-vision.ts`: new exported `parseAgyDecision` — ANY parse
  failure (missing JSON or schema-invalid) on print-timeout partial output throws
  a non-repairable `AgentProviderError` (no second 130s cycle); salvagable JSON
  alongside the marker still parses normally. A runner-side kill (`timedOut`)
  surfaces its own actionable error.

**Runner — `services/runner/src/domains/argent/`**
- `cli.ts`: `runArgentBin` races its timeout against the pipe reads (same inherited-pipe
  hang); timeout still throws `ArgentError` code `TIMEOUT` with the same message,
  and the orphaned pipe reads are settled quietly so they can't surface as an
  unhandled rejection after the throw.

**Tests**
- `case-executor.test.ts`: decide-timeout fails the case with a clear error + failed step;
  per-attempt budgeting lets two slow-but-working attempts (combined over budget)
  succeed; timeline asserts the label is set before the model responds; existing command-timeline
  test updated for the new decide label.
- New `drivers/probe.test.ts` (deadline kill, partial output) and
  `drivers/antigravity-vision.test.ts` (parse paths, non-repairable print timeout).

## How to verify

1. `bun run lint:ci && bun run test && bun run check` — all green.
2. Start an agent run with a slow CLI provider (e.g. Antigravity): the trailing row on
   `/runs/$id` shows `AI deciding next action…` + `Executing…` during the call instead of
   a silent `In progress…`, then swaps to the `yoqa action …` line.
3. With an injected decide that never resolves (unit test above), the run errors with
   "AI decide timed out after …" and a failed step — not `running` forever.

## Follow-ups

- Optional run-level watchdog: error a run after N minutes with no step/screenshot/phase
  change (covers phases outside decide).
- The timed-out decide attempt is raced, not aborted — propagate an AbortSignal down
  to `runCommand` so a hung provider child is actually killed instead of leaked.
- Extract the deadline-race shape shared by `probe.runCommand` and `argent.runArgentBin`
  into one helper (kept separate for now: partial-output return vs JSON-throw have
  different settle semantics).
- Antigravity model turns exceeded 2 min consistently (`[agy] print timeout after 2m0s`) —
  consider a faster default model or surfacing provider latency hints in Settings.
- A first screenshot of 4 KB (likely a locked/off screen) during the stuck run — worth a
  separate "screen looks blank" warning.
