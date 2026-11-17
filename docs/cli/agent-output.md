# Agent output: the CLI's one emission seam

## Goal

Stop `yoqa` from being able to flood a calling agent's context window on a single screen read, and
put every byte the CLI writes for an agent behind one seam that can be bounded, measured and
guarded later.

Then measure it, so "stays inside a context window" is something anyone can check rather than a
slogan.

Covers two tickets of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435):
[#442](https://github.com/Aris-ngoy/qa-agent/issues/442), the seam itself, and
[#436](https://github.com/Aris-ngoy/qa-agent/issues/436), **Emitted usage** accounting and
`yoqa usage`. Every other command still writes the way it did, so nothing else moved.

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

**One Device Session id, derived rather than added.** The ledger is keyed by Device Session, but
the runner publishes no session id. At most one Device Session exists per device id at a time, and
`connectedAt` is stamped at connect and preserved across a retarget — so `<deviceId>@<connectedAt>`
is stable for a session's whole life and different for the next one, and "a new Device Session
starts from zero" falls out with no runner change. Rejected: adding a session id to the runner's
`/devices/active` payload, which is a schema change for something already derivable.

**Accounting runs after the output is written.** `emitAgentOutput` writes to stdout first, then
resolves the session (one localhost round-trip) and appends. A calling agent has its answer before
any ledger work happens, so the one honest objection to the extra round-trip — latency on the path
the agent waits for — does not apply. Rejected: recording before writing, and fire-and-forget after
writing (a short-lived CLI process exits before a dangling promise lands).

**The ledger is on the CLI side.** Each CLI process is short-lived, so a running total cannot live
in memory; and the runner cannot know whether the CLI printed compact JSON or a formatted tree, so
only the CLI knows what was actually emitted.

**Best-effort to the point of silence.** A missing, corrupt or unwritable ledger reads as zero and
writes as a no-op. A line that will not parse costs its own tokens, not the whole total. Nothing
here can change a command's output or its exit code. This is the `pruneOldRunScreenshots` posture,
for the same reason: accounting must never be able to break a QA session.

**The Output budget ships with #436, the threshold with #437.** A report that says "of 250,000" on
a 1M-window model is a lie, so `YOQA_OUTPUT_BUDGET` is here. The stderr warning and its high-water
threshold are #437's whole job and are not here.

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

### Emitted usage and `yoqa usage` (#436)

- `packages/cli/src/emitted-usage.ts` — pure: `estimateTextTokens` (characters over a documented
  divisor), `estimateImageTokens` (pixels over a documented divisor), the Output budget and its
  env override, `deviceSessionId`, and `formatEmittedUsage`.
- `packages/cli/src/emitted-usage-ledger.ts` — the ledger: one JSON line per command under
  `~/.yoqa/emitted-usage.jsonl`, `{session, command, tokens, at}`. Clock and path injected;
  `YOQA_EMITTED_USAGE_PATH` overrides the path the way `YOQA_DB_PATH` overrides the catalog
  database, so CI keeps its accounting off a developer's own.
- `AgentOutput` gains `tokens`, and a payload may name an Agent image. The seam prices what it
  wrote, not what it read: a trimmed tree is charged for its 80 rows, not its 1000 elements.
- `yoqa usage` reports the running total against the budget with a per-command breakdown, dearest
  command first. `--json` is compact, `--pretty` indents.

```
$ yoqa usage
Emitted 24,118 of 250,000 tokens (10%) — Device Session sim-ABC@1700000000000
  action tap   18,402 (12 calls)
  screen        5,716 (9 calls)
```

- Glossary: **Emitted usage** and **Output budget** in `CONTEXT.md`, each listing the other
  accounting concept under `_Avoid_` so Call usage and Emitted usage cannot be conflated.

#### The formula, and what it is not

`ceil(chars / 4)` for text and `ceil(width × height / 750)` for an Agent image. Both are the
published rules of thumb — the ~4-characters-per-token figure in Anthropic's and OpenAI's own
tokenizer guidance, and Anthropic's `width × height / 750` for image input. No tokenizer is loaded
and no model is consulted, deliberately: a provider-specific count would be more precise about a
number nobody is billed for. A tree of coordinates tokenizes worse than prose and a URL worse
still, so the figure is an order of magnitude for deciding when to delegate or compact. It is
never presented as a bill.

#### Two things to know about the ledger

It is keyed by session but kept in one file, because a web device id makes a poor filename. And it
is append-only with one exception: past 1 MB, an append rewrites the file with only the current
session's records. Append-only in a user's home directory otherwise grows without bound, and every
total Yoqa reports is scoped to one session anyway. Log compaction, named here rather than left for
someone to discover.

## How to verify

```bash
bun test packages/cli/src/agent-output.test.ts          # the seam, pure
bun test packages/cli/src/emitted-usage.test.ts         # estimator, budget, report formatter
bun test packages/cli/src/emitted-usage-ledger.test.ts  # the ledger, over an injected clock + path
bun test packages/cli/src/emitted-usage-command.test.ts # `yoqa usage`, against a fake runner
bun test packages/cli/src/screen-source.test.ts         # `yoqa screen`, against a fake runner
bun test packages/runner-client/src services/runner/src/domains/runs  # replay, Branch, Decide loop
```

On a device, against a dense screen:

```bash
yoqa screen                 # ≤ 80 rows, ending in "… N more elements omitted"
yoqa screen --limit 200     # more rows
yoqa screen --json | wc -l  # 1
yoqa screen --full          # the whole raw tree, on one line

yoqa usage                  # what this Device Session has emitted, against the budget
yoqa screen && yoqa usage   # the total goes up; `screen` appears in the breakdown
yoqa devices disconnect && yoqa devices connect ios   # the total is back to zero
YOQA_OUTPUT_BUDGET=1000000 yoqa usage                 # reported against 1,000,000
```

## Follow-ups

The rest of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435), in dependency order: the
**Output budget** stderr warning (#437), compact JSON across the remaining commands (#438),
migrating the rest of the CLI's output through the seam (#439), the guard test that keeps the seam
single (#440), and the skill's context-budget section (#441).

**The image arm of the estimator has no call site yet.** `estimateImageTokens` is in #436's
acceptance criteria and ships tested, and the seam prices any payload that names an Agent image —
but the only payload through the seam today is `screen`, which is a tree. `action --screenshot` is
the first command that will carry one, when #439 moves it onto the seam; that call site will also
have to read the PNG's dimensions, which nothing does today. Stated here rather than left looking
like an oversight.

**`yoqa usage` writes with `console.log`, like every other command #439 has yet to migrate.** It
is new output on an unmigrated path, which #440's guard will catch if #439 misses it. Whether the
reporting command should account for its own emission is #439's call.

**Nothing prunes old sessions' records.** The 1 MB compaction drops them only when the file grows
past the cap, so a long-lived ledger keeps dead sessions until then. Age-based pruning, the way
`pruneOldRunScreenshots` does it, would be the obvious next step if that ever matters.

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
