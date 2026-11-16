# Agent output: the CLI's one emission seam

## Goal

Stop `yoqa` from being able to flood a calling agent's context window on a single screen read, and
put every byte the CLI writes for an agent behind one seam that can be bounded, measured and
guarded later.

This is the **expand** step of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435) (ticket
[#442](https://github.com/Aris-ngoy/qa-agent/issues/442)): the seam exists and `yoqa screen` goes
through it. Every other command still writes the way it did, so nothing else moved.

## Plan summary

**One seam, in the CLI.** A pure function takes what the runner answered plus the caller's output
options and returns the exact text to write; one thin wrapper writes it. Pure means the cap, the
wording and the JSON shape are testable with no runner and no device.

**The cap is not in the runner's shared Screen read.** Case Script Branches match against that same
read, and so does the Decide loop's screen snapshot. Capping there would silently change which side
a saved script takes, so trimming happens only where output is emitted to a calling agent.
Rejected: a `limit` on `GET /screen`, for exactly that reason.

**One row cap, shared.** The Decide loop's row limit and its `… N more elements omitted` wording
moved into `@yoqa/runner-client`, which both the runner and the CLI already depend on, and the
constant was renamed `MAX_SCREEN_ROWS` — "snapshot" was Decide-loop-local vocabulary, and the
glossary's term is **Screen**. Two surfaces bound the same tree; a second declaration would let
them drift. Rejected: re-declaring 80 in the CLI, and importing the runner's agent module for it.

**Compact JSON, `--pretty` to undo.** Indentation is tokens with no content. Rejected: keeping
2-space JSON as the default and adding an opt-in `--compact`, which leaves the expensive shape as
the one agents get by default.

**The cleaned tree is capped in every rendering; the raw tree never is.** `--json` is a screen read
like any other, and its rows are dearer than the formatted ones, so it caps too — with
`omittedElements` in the payload, because a silent trim would mislead a caller hunting an `--id`.
`--full` stays uncapped in fidelity: it is the escape hatch for a genuinely hard problem.

## What shipped

- `packages/cli/src/agent-output.ts` — the seam: `formatAgentOutput` (pure), `writeAgentOutput`
  (the only writer), `parseScreenLimit` (commander's coercion for `--limit`).
- `packages/runner-client/src/screen-rows.ts` — the shared row cap and omitted-line wording. The
  Decide loop's `formatScreenSnapshot` now imports both; its output is unchanged.
- `yoqa screen` writes through the seam and gains `--limit <rows>` and `--pretty`. The formatted
  listing, the source line and the row format are byte-identical to before, up to the cap.
- `yoqa screen --json` and `--full` emit single-line JSON. **Breaking for anyone parsing
  whitespace**, which nothing should be; `--pretty` restores indentation.
- Glossary: **Agent output** in `CONTEXT.md`.
- The four CI failure-diagnosis scripts that capture `yoqa screen --json` as an artifact now pass
  `--pretty --limit 1000`. Those files are downloaded and read by a human when a device job fails,
  so they want the whole tree, indented — the opposite of what an agent wants.
- The shipped skill and the public docs say what the cap is and how to raise it.

## How to verify

```bash
bun test packages/cli/src/agent-output.test.ts   # the seam, pure
bun test packages/cli/src/screen-source.test.ts  # the command, against a fake runner
bun test packages/runner-client/src services/runner/src/domains/runs  # replay, Branch, Decide loop
```

On a device, against a dense screen:

```bash
yoqa screen                 # ≤ 80 rows, ending in "… N more elements omitted"
yoqa screen --limit 200     # more rows
yoqa screen --json | wc -l  # 1
yoqa screen --full          # the whole raw tree, on one line
```

## Follow-ups

The rest of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435), in dependency order:
**Emitted usage** accounting and its ledger (#436), the **Output budget** stderr warning (#437),
compact JSON across the remaining commands (#438), migrating the rest of the CLI's output through
the seam (#439), the guard test that keeps the seam single (#440), and the skill's context-budget
section (#441).

Known gap until #439 lands: the seam is the only writer for `screen` and nothing else, so
`writeAgentOutput` is not yet enforceable as the single path to stdout. That is #440's job.

Two row formatters still print the same tree in near-identical shapes: this seam's, and the Decide
loop's `formatScreenSnapshot`. Only the cap and the omitted line are shared. Unifying them would
mean adopting the Decide loop's sorting, rounding and `id=` column in `yoqa screen`, which changes
that command's long-standing output for reasons this ticket has none — so it is left alone
deliberately, not overlooked.

`yoqa screen --json` and `--full` landed compact here, ahead of #438, because `--full` could not be
compacted without `--pretty` to undo it and a half-compact command would be incoherent. #438 is
therefore the remaining 16 JSON sites, not 17.
