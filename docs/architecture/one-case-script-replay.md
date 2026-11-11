# One Case Script replay

Terms: **Case Script**, **Branch**, **Action**, **Run**, **Case executor**, **Settle**, **Screen** in [`CONTEXT.md`](../../CONTEXT.md). Decisions this builds on: [ADR-0003](../adr/0003-case-executor-test-seam.md) (the Case executor is the Run test seam), [ADR-0006](../adr/0006-case-script-file-yaml.md) (one Case Script model), [ADR-0008](../adr/0008-case-script-branches.md) (the action list is recursive).

## Goal

Replay a Case Script the same way wherever it runs. Before this change the Branch-aware walk over the action list was written twice: once in the Case executor (`executeScriptCase`, for Runs) and once in `runCaseScript` (for `yoqa script run` and the Inspector). The two had already drifted apart. A Run clamped every `wait` to 500–3000 ms and the CLI did not. Only the CLI let a caller change the Branch and assert default timeouts. The runner built each `ActionRequest` inline instead of calling `caseScriptActionRequest`. A Run step's `action` was `z.unknown()`, so the run report checked every field with `typeof`.

## Plan summary

- **One deep module, small port.** `replayCaseScript(script, port)` in `@yoqa/runner-client` (`case-script-replay.ts`) is the only walker. It owns step order, Branches (recursion, path, `total` growing when a side is picked), `wait`, `assert`, abort, and "stop at the first failure, skip the rest". The port is what it needs from the outside: perform an Action, read the Screen, a clock, abort, an optional Dead Session test, and a step sink.
- **Two adapters.** The Case executor's `executeScriptCase` (runner) and `runCaseScript` (RunnerClient: CLI and Inspector). Each one keeps what belongs to it:
  - **Runner:** Settle after each Action (`POST_ACTION_SETTLE_MS`, `clock.sleep(settleMs)`, inside its `performAction`), the screenshot before each step and the Branch's decision screenshot (in its step sink), the current command, Run steps (`appendStep`), and the closing `done` / `fail` step.
  - **Client:** the `pauseAfterActionMs` pause and the `AbortSignal`.
- **Where it lives.** `services/runner` already depends on `@yoqa/runner-client`, and the CLI and desktop import from it, so the walker lives next to `caseScriptActionRequest` and `checkScreen`.
- **One rule where they disagreed:**
  - `wait` sleeps exactly its `ms` (0–10000, as the schema and the Case Script file docs say). This is the CLI's rule, not the Run's. The 500–3000 ms clamp came from agent decisions, which `buildScriptFromDecisions` still clamps when it records a script. [`case-script-yaml.md`](../runs/case-script-yaml.md) removed it from the CLI on purpose. Keeping it in Runs would silently shorten a hand-written `wait: 5000`.
  - The Branch (2 s) and assert (5 s) defaults are fixed, as in a Run. The client's `defaultBranchTimeoutMs`, `defaultAssertTimeoutMs` and `assertPollMs` options are gone; only tests used them.
  - The Dead Session test is part of the port. The runner passes `isDeadSessionError`. The client has none, as before.
- **A typed Run step `action`.** `runStepActionSchema` is lenient. A stored action that is not an object reads as `{}`. A known field of the wrong type reads as absent, and fields it does not know are kept. Every stored Run still parses, and `run-report.ts` and the desktop step row read typed fields instead of checking each one with `typeof`.
- **Rejected:**
  - *Moving CLI and Inspector replay onto the runner's Case executor over HTTP.* That would make a local `script run` depend on the catalog and on Runs.
  - *Keeping both walkers behind shared helpers.* That is the shallow version, and the walk itself is where they drifted.
  - *Putting the pre-step screenshot or Settle in the walker.* The client has neither. The Settle follow-up changes the runner's adapter only.
  - *A strict discriminated union for the Run step `action`.* Older rows and agent cycles would stop parsing.

## What shipped

- **`@yoqa/runner-client`**
  - New: `replayCaseScript`, `CaseScriptReplayPort`, `CaseScriptReplayResult`, and `caseScriptCheckTimeoutMs` (the one place that resolves the assert / Branch default).
  - `runCaseScript` is now a short adapter. Its options are `signal`, `onStep`, `pauseAfterActionMs`, `sleep` and `now`.
  - The walker checks abort again after the `running` sink returns, so it never starts a step once a Run has been cancelled while its screenshot was being taken. A throw from the sink fails that step.
  - New: `runStepActionSchema`, `RunStepAction`, `RunStepActionFields`. `RunStep.action` is typed.
  - `readStepCycle`, `actionSummary`, `formatStepCommand` and `stepReasoning` take the typed action.
- **Runner**
  - `executeScriptCase` is the Case executor's adapter: about 150 lines in place of about 440, with no per-Action `if` chain.
  - Run step records are built by `replayStepAction`, `replayStepDetail` and `replayStepCommand`. They are the same as before, except that a replayed tap now also records `double` / `durationMs`, and a `wait` records the `ms` it really waited.
  - `loadRun` parses each step's `action` with `runStepActionSchema`.
  - `executeRun` is unchanged.
- **Tests**
  - `case-script-replay.test.ts` tests the walker through `replayCaseScript` with a fake port: Actions, waits, asserts, Branches, nesting, failure and skip, abort, a sink that fails, and a Dead Session. It keeps a few adapter tests for `runCaseScript`.
  - The Branch semantics tests that `case-executor.test.ts` repeated are removed (polling, own timeout, not-visible, missing `else`, unreadable Screen, abort inside a side). The Run step shape tests stay, and a new test covers the exact `wait` with no Settle after it.
  - `schemas.test.ts` covers reading stored actions.

## How to verify

1. `bun test packages/runner-client/src/case-script-replay.test.ts services/runner/src/domains/runs/case-executor.test.ts packages/runner-client/src/run-report.test.ts packages/runner-client/src/schemas.test.ts packages/runner-client/src/script-format.test.ts`
2. `bun run lint:ci && bun run check && bun run test`
3. Manual: a Case Script with `- wait: 5000` takes 5 s in a Run, the same as in `yoqa script run`, and its Run step shows `sleep 5`. A Branch in a Run and in the Inspector takes the same side on the same Screen.

## Follow-ups

- Settle and post-action timing: a separate PR that changes the Case executor's `performAction` adapter only.
- Type `AppendCaseStep.action` as `RunStepAction` on the write side as well. Agent steps still write untyped objects.
