# Agent output: the CLI's one emission seam

## Goal

Stop `yoqa` from being able to flood a calling agent's context window on a single screen read, and
put every byte the CLI writes for an agent behind one seam that can be bounded, measured and
guarded later.

Then measure it, so "stays inside a context window" is something anyone can check rather than a
slogan.

Then warn before the window fills, rather than after the work is lost.

Then stop charging a calling agent for whitespace on every command, not just one.

Covers four tickets of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435):
[#442](https://github.com/Aris-ngoy/qa-agent/issues/442), the seam itself;
[#436](https://github.com/Aris-ngoy/qa-agent/issues/436), **Emitted usage** accounting and
`yoqa usage`; [#437](https://github.com/Aris-ngoy/qa-agent/issues/437), the **Output budget**
threshold warning; and [#438](https://github.com/Aris-ngoy/qa-agent/issues/438), compact JSON
across every command. Non-JSON output still writes the way it did — that is #439.

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

**The Output budget shipped with #436, ahead of its ticket.** A report that says "of 250,000" on a
1M-window model is a lie, so `YOQA_OUTPUT_BUDGET` could not wait for #437.

**A crossing is derived, not remembered.** There is no warned-flag and no new state file. The
ledger is append-only, so the total before a command is the total after it minus what that command
emitted, and "has this already been warned about" is simply "were both totals in the same band".
`appendEmittedUsage` therefore returns the session's new running total. Rejected: a flag on disk or
a marker record in the ledger, both of which add state to answer a question two numbers already
answer, and both of which would have to be reset on a new Device Session.

**A band is the high-water mark, then every further whole budget.** The marks are 200k, 250k,
500k, 750k on the defaults, and the line fires when the band rises. The literal reading of "once
per threshold crossing" is one line per session forever, which goes quiet exactly when a runaway
session most needs telling. Rejected on the way there: multiples of the high-water mark alone
(`floor(total / mark)`), which puts the second mark at 160% of the budget and so says *nothing* to
a session that has used up the very window it was warned about — the one crossing nobody should
miss. Found in review, not in the design.

**The warning fires on stderr, inside the seam, after the append.** stdout therefore cannot be
touched by it, so it is byte-identical whether or not the line fires; and it sits behind the output
write, so nothing is delayed ahead of the answer the agent is waiting for. `yoqa usage` does not
warn: it is the report, and a report that warns about itself is noise. Rejected: warning before the
write (stdout and stderr interleave unpredictably, and the agent's answer should come first).

**The row cap override is read in the seam, not in each command.** `emitAgentOutput` resolves it
and `formatAgentOutput` stays pure, so every command #439 moves across honours the knob without
having to remember to. `--limit` still outranks it, and the shared constant is still the default.

**The row cap override moves Agent output only.** `YOQA_SCREEN_ROWS` changes this seam's default
and deliberately not the Decide loop's `formatScreenSnapshot`, though both read `MAX_SCREEN_ROWS`.
The snapshot is model input: shrinking it changes which decisions a run makes, not what a context
window costs. And because the CLI autostarts the runner, which inherits its environment, one knob
for both would make that happen silently. Rejected: a single knob for the single constant, which is
tidier and wrong.

**The suppression switch reads the same words as `YOQA_NO_AUTOSTART`.** `1`, `true` or `yes`, so
the CLI has one spelling of "off" rather than two.

**One JSON path, and commands stop owning the decision.** The seam gained a `json` payload kind,
so a command hands over a body and the seam decides the shape. Rejected: leaving each command to
call a shared `agentJson` helper itself, which is what #436 did for `usage` — it removes the
duplicated `null, 2` but keeps forty commands able to make a different choice, and keeps them off
the accounting path.

**`--json` and `--pretty` are held together by a test, not a helper.** The first design was an
`addJsonOptions(cmd)` helper. It was dropped: wrapping forty existing chains in a call costs an
indentation level at every site, and — the real objection — a helper cannot catch a command that
does not call it. A test that walks the built command tree can, and it names the offender. The
help text for `--pretty` is still declared once.

**The ledger's command name comes from commander.** `commandPath(cmd)` walks up from the command
commander hands the action, stopping before the root, whose name is the program's. Forty literals
would go stale the first time a command was renamed, and tokens attributed to a command nobody can
run are worse than no breakdown. This also replaced the one literal `"screen"` #436 left behind.

**The session lookup is memoized for the command being run.** It was one localhost round-trip per
emission, which was fine while `screen` was the only caller. `script run --json` emits a line per
action, so a twenty-action replay would have made twenty requests for an answer that cannot change
mid-command. Scoped by a `preAction` hook to one invocation rather than one process: in a real
`yoqa` run those are the same thing, but the tests run many commands in one process and a reconnect
between two of them must never be served the previous session. Rejected: a process-lifetime cache,
which would have made #436's "a new Device Session starts from zero" test pass against a stale id.

## What shipped

- `packages/cli/src/agent-output.ts` — the seam: `formatAgentOutput` (pure), `emitAgentOutput`
  (the only writer; `writeAgentOutput` until #436 gave it accounting to do), `agentJson` (the one
  JSON path), `parseScreenLimit` (`--limit` as the command reads it).
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
- `packages/cli/src/active-session.ts` — the one place accounting touches the runner, and the only
  CLI call that carries a deadline of its own (2s). The seam looks the session up *after* output is
  written, so a runner that accepts the connection and then stops answering must not hang a command
  with nothing left to say. The deadline is a parameter, so its test bounds a hanging server in
  50ms rather than waiting the real 2s — the posture
  [unit-test-speed.md](../architecture/unit-test-speed.md) asks for.
- `agentJson` is exported from the seam and `yoqa usage` uses it, so the `JSON.stringify(body,
  null, 2)` pattern #438 has to delete does not gain a new instance here.
- `yoqa usage` reports the running total against the budget with a per-command breakdown, dearest
  command first. `--json` is compact, `--pretty` indents, and the JSON shape is the same whether or
  not a session is connected so an agent can parse it either way.

```
$ yoqa usage
Emitted 24,118 of 250,000 tokens (10%) — Device Session sim-ABC@1700000000000
  action tap   18,402 (12 calls)
  screen        5,716 (9 calls)
```

- Glossary: **Emitted usage** and **Output budget** in `CONTEXT.md`, each listing the other
  accounting concept under `_Avoid_` so Call usage and Emitted usage cannot be conflated.

### The Output budget warning (#437)

- `budgetWarning` in `packages/cli/src/emitted-usage.ts` — pure: two totals, a budget and a
  threshold in, one line or null out. The band arithmetic is private to it; the crossing is the
  behaviour worth pinning, not the band number.
- `appendEmittedUsage` returns the session's new running total, or null when the ledger could not
  be written or read back. Null means "no judgement available", not "zero", so a broken ledger
  warns about nothing rather than warning about a total it invented.
- **This costs every emitting command one read of the ledger.** Before, the file was read only
  when `stat` said it was over 1 MB; now the running total needs it on every append, so each
  emitting command gains a read of at most ~1 MB and a `JSON.parse` per line. The read is reused
  for log compaction rather than done twice. It sits after stdout like the rest of the accounting,
  so it delays nothing the calling agent is waiting for — and unlike the session lookup it carries
  no deadline, because a local read of a file we have just appended to successfully has no
  accept-then-hang failure mode, and `appendFile`, `mkdir` and `stat` were already on that path
  before this ticket. Named here rather than left to be discovered in a profile.
- `emitAgentOutput` writes the line with `console.error` after the append. Everything in that tail
  is still inside the same `try` that swallows accounting failures, so a warning cannot fail a
  command either.
- Four environment variables now shape Agent output and its accounting:

| Variable | Default | What it does |
|---|---|---|
| `YOQA_OUTPUT_BUDGET` | `250000` | the budget totals are reported and warned against |
| `YOQA_OUTPUT_WARN_AT` | `80` | the high-water mark, as a **percent of the budget** |
| `YOQA_SCREEN_ROWS` | `80` | the Agent output row cap; `--limit` still outranks it |
| `YOQA_NO_OUTPUT_WARNING` | unset | `1`/`true`/`yes` silences the warning, for CI |

  Each keeps its default rather than guessing at an unusable value, the posture
  `resolveOutputBudget` set in #436.
- `packages/cli/src/env.ts` — the two shapes every non-path `YOQA_*` knob has: `envWholeNumber`
  (a whole number with a floor of 1, or the default) and `envFlagEnabled` (`1`/`true`/`yes`).
  Added because this ticket would otherwise have been the third copy of the integer parser and the
  second copy of `shouldSkipAutostart`'s flag reader, which now calls it too. One spelling of
  "unusable value" and one of "off", rather than one per knob.

```
$ yoqa screen
Read from com.demo (target app)
  120, 340  200x44  Sign in
  …
Yoqa has emitted 203,418 of 250,000 tokens (81%) into this context — delegate further exploration to a sub-agent, or compact.
```

The last line is on stderr; the rest is stdout.

#### What "once" rests on

The prior total is derived, not read: `total - output.tokens`. Two things can make it wrong, both
accepted. A ledger line that will not parse is dropped by `readRecords`, so a corrupt file can
shift a total and move a mark. And two `yoqa` processes emitting for the same Device Session at the
same moment each read back the other's record, so one of them can compute a prior total that was
never true. The cost either way is a duplicated or skipped *advisory line*, never a wrong report
and never a failed command — and the alternative, a warned-flag on disk, would be new state that
has to be reset per Device Session to answer a question two numbers already answer.

#### Why a percent and not a token count

`YOQA_OUTPUT_WARN_AT=80` is read as 80% of the budget, not 80 tokens. A token count would be a
second figure to keep in step with `YOQA_OUTPUT_BUDGET` every time the budget moved, and the
threshold is only ever meaningful as a share of the window. It takes a whole number, so there is no
float to misparse — and it is not capped at 100, because a mark above the budget is a coherent
thing to ask for even if nobody should.

#### The formula, and what it is not

`ceil(chars / 4)` for text and `ceil(width × height / 750)` for an Agent image. Both are the
published rules of thumb — the ~4-characters-per-token figure in Anthropic's and OpenAI's own
tokenizer guidance, and Anthropic's `width × height / 750` for image input. No tokenizer is loaded
and no model is consulted, deliberately: a provider-specific count would be more precise about a
number nobody is billed for. A tree of coordinates tokenizes worse than prose and a URL worse
still, so the figure is an order of magnitude for deciding when to delegate or compact. It is
never presented as a bill.

The largest known error is script rather than content: CJK and Cyrillic run closer to one token per
character, so a localized app's tree can cost several times what Yoqa reports. Found by verifying
against a real page — `example.com`'s four-language tree reported 262 tokens. Left uncorrected on
purpose: a script-aware divisor would still be a guess, and the number answers "am I near the
budget", which an understatement on one screen does not change. Named in the estimator's comment so
nobody reads the figure as precise.

#### Two readings worth stating

**"A corrupt ledger yields a zero total"** is implemented as *never an error*, not as *always
zero*: a line that will not parse costs its own tokens and the rest of the total survives. A
partial total is more use than nothing and still cannot throw. Only a file that cannot be read at
all reads as zero.

**"One record per command"** is about granularity, not about recording zeroes. A command that
emitted nothing — an empty tree — appends nothing, which also spares it the session lookup. The
ledger answers "which commands are expensive", and a row of zero tokens is not an answer.

#### Two things to know about the ledger

It is keyed by session but kept in one file, because a web device id makes a poor filename. And it
is append-only with one exception: past 1 MB, an append rewrites the file with only the current
session's records. Append-only in a user's home directory otherwise grows without bound, and every
total Yoqa reports is scoped to one session anyway. Log compaction, named here rather than left for
someone to discover.

### Compact JSON everywhere (#438)

- **42 commands** now emit single-line JSON through the seam. Two of them already had `--pretty`
  (`screen` from #442 and `usage` from #436); the other forty had no way to be read by eye at all,
  and now do.
- `packages/cli/src/command-output.ts` — the bridge from commander to the seam: `commandPath`,
  `emitJson`, and the `--pretty` help text. Its own module so `program.ts` gains one call per
  command rather than one copy of the emit plumbing per command, and so the seam never has to know
  what commander is.
- `packages/cli/src/active-session.ts` — `sessionIdOnce` and `resetSessionCache`.
- Every migrated command contributes to **Emitted usage**, named as a caller typed it. `yoqa usage`
  breakdowns now read `devices ios`, `action tap`, `runs create` rather than only `screen`.
  "Contributes" means *can*: accounting is keyed by **Device Session**, so a command run before
  `yoqa devices connect` still has nothing to account to and records nothing. That is #436's design
  and not new here, but it is the difference between "every command contributes" and "every run
  does".

Four commands did not fit the shape, and the call for each:

| Command | What happens |
|---|---|
| `health` | Has only ever printed JSON, so it gained `--pretty` and no `--json`: there is nothing to switch on. |
| `script run --json` | Prints a line per action, so its `onStep` is now `async`. `runCaseScript` awaits every `onStep`, so each line is accounted like any other emission rather than fire-and-forget. |
| `yoqa usage --json` | Goes through the path too, so reading the meter now costs what reading it costs. The total is read before the line is written, so a report never includes itself. |
| `script validate` and `skill install` | Have no `--base-url`, so there is no runner to ask for a Device Session: they emit through the seam and record nothing. |

The `--out` file writes in `script export` and `benchmark` stay indented. A file on disk is read by
a person, which is the same reason the CI failure-diagnosis scripts pass `--pretty`.

#### Breaking: the output shape

**Every `--json` output is now one line.** Anyone parsing Yoqa's JSON with a line-oriented tool —
`grep`, `awk`, `head -n`, a regex over the pretty shape — will see different bytes. Anyone using a
JSON parser sees exactly the same content. `--pretty` restores the old shape where a human or a
script wants it.

That equivalence is asserted end to end for one command of each shape — `status` (a plain body),
`signing` (a body whose other half is a human rendering), `devices ios` (a subcommand),
`action tap` (options arriving as an untyped bag) and `health` (no `--json` to switch) — not for
all 42. What holds for all 42 is the structural guarantee: a test walks the built command tree and
fails if any command offering `--json` does not also offer `--pretty`, counting the flags it
inherits from its parents as well as its own.

`yoqa health` is the one to call out separately: it has no `--json` flag, so a person typing it
bare to check the runner is up now gets one line instead of four. `yoqa health --pretty` is the
old output.

Nothing in this repo parsed the pretty shape — the four CI failure-diagnosis scripts already pass
`--pretty` for exactly this reason, and they were changed in #442.

#### `--pretty` costs something on one command

`script run --json` prints one line per action, which is line-delimited JSON a caller can parse as
it arrives. `script run --json --pretty` prints an *indented object* per action, which is not: the
stream stops being line-delimited. That is accepted rather than fixed, because `--pretty` is for a
person reading a replay by eye and the compact default — the one an agent gets — is unaffected.
No other command emits more than once, so no other command has the question.

#### What #438 did not do

Non-JSON output is untouched. `formatSigningStatus`, `printDevicesTable`, the `ok <kind>` lines
and every other human rendering still go straight to `console.log`. That is #439's batch, and
until it lands a command can have its JSON on the seam and its text off it.

## How to verify

```bash
bun test packages/cli/src/compact-json.test.ts          # every command's JSON, and the option guard
bun test packages/cli/src/command-output.test.ts        # the name the ledger records
bun test packages/cli/src/active-session.test.ts        # the lookup, its deadline, and its memo
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

YOQA_SCREEN_ROWS=5 yoqa screen                        # 5 rows, then the omitted line
YOQA_SCREEN_ROWS=5 yoqa screen --limit 40             # 40 rows: --limit still wins
```

The warning, on a session that has emitted something. A small budget reaches the mark without a
whole QA session, and `2>/dev/null` is how you see that stdout never carried it:

```bash
YOQA_OUTPUT_BUDGET=2000 YOQA_OUTPUT_WARN_AT=10 yoqa screen   # one stderr line on the crossing
YOQA_OUTPUT_BUDGET=2000 YOQA_OUTPUT_WARN_AT=10 yoqa screen   # silent: still the same band
YOQA_OUTPUT_BUDGET=2000 YOQA_OUTPUT_WARN_AT=10 yoqa screen 2>/dev/null  # stdout only, unchanged
YOQA_NO_OUTPUT_WARNING=1 YOQA_OUTPUT_BUDGET=2000 yoqa screen # silent whatever the total
yoqa usage                                                   # the total the warning quoted
```

Compact JSON, on any command:

```bash
yoqa status --json | wc -l            # 1
yoqa status --json --pretty | wc -l   # more than 1
diff <(yoqa status --json | jq -S .) <(yoqa status --json --pretty | jq -S .)   # no output
yoqa health | wc -l                   # 1 — it has no --json to switch
yoqa devices ios --json && yoqa usage # `devices ios` appears in the breakdown
```

Verified on a real Browser device against a dense Wikipedia article, with
`YOQA_EMITTED_USAGE_PATH` pointed at a temp file so the run left nothing in `~/.yoqa`. One
`yoqa screen` of that page costs ~910 tokens, so a 2,000-token budget warning at 10% walks every
band in four reads:

| read | total | stderr |
|---|---|---|
| 1 | 911 | `Yoqa has emitted 911 of 2,000 tokens (46%) into this context — delegate further exploration to a sub-agent, or compact.` |
| 2 | 1,822 | — same band |
| 3 | 2,733 | `Yoqa has emitted 2,733 of 2,000 tokens (137%) …` — the budget itself |
| 4 | 3,644 | — same band |

stdout was 81 rows every time, warning or not. `YOQA_NO_OUTPUT_WARNING=1` gave three silent reads
that still accounted all 2,733 tokens, and `YOQA_SCREEN_ROWS=5` gave 6 lines, `--limit 20` gave 21,
and `YOQA_SCREEN_ROWS=nonsense` fell back to 81.

## Follow-ups

The rest of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435), in dependency order:
migrating the rest of the CLI's output through the seam (#439), the guard test that keeps the seam
single (#440), and the skill's context-budget section (#441). #441 is where the shipped skill
learns to read the budget warning and act on it — #437 wrote the line, not the instructions for
responding to it.

**The budget warning now has 42 commands that can trigger it**, not one. #437 shipped with only
`screen` on the seam; a session's total is now the real cost of its machine-readable output. It is
still an undercount of a session's *whole* cost until #439 moves the human-readable output across.

**The image arm of the estimator has no call site yet.** `estimateImageTokens` is in #436's
acceptance criteria and ships tested, and the seam prices any payload that names an Agent image —
but the only payload through the seam today is `screen`, which is a tree. `action --screenshot` is
the first command that will carry one, when #439 moves it onto the seam; that call site will also
have to read the PNG's dimensions, which nothing does today. Stated here rather than left looking
like an oversight.

**`yoqa usage`'s human-readable form still writes with `console.log`**, like every other text path
#439 has yet to migrate. Its `--json` form is on the seam and accounts for itself.

**`script run --json` reads the ledger once per action.** Each emission appends and then reads back
to compute the running total (#437). A twenty-action replay is twenty reads of a file capped at
1 MB, each after its line is already on stdout, against twenty HTTP round-trips and 800 ms of
settle time per action — noise next to the work, but named rather than left to be found in a
profile.

**Nothing prunes old sessions' records.** The 1 MB compaction drops them only when the file grows
past the cap, so a long-lived ledger keeps dead sessions until then. Age-based pruning, the way
`pruneOldRunScreenshots` does it, would be the obvious next step if that ever matters.

Known gap until #439 lands: the seam is the only writer for every `--json` path and no text path,
so `emitAgentOutput` is not yet enforceable as the single route to stdout. That is #440's job.

Two row formatters still print the same tree in near-identical shapes: this seam's, and the Decide
loop's `formatScreenSnapshot`. Only the cap and the omitted line are shared. Unifying them would
mean adopting the Decide loop's sorting, rounding and `id=` column in `yoqa screen`, which changes
that command's long-standing output for reasons this ticket has none — so it is left alone
deliberately, not overlooked.

`yoqa screen --json` and `--full` landed compact in #442, ahead of #438, because `--full` could not
be compacted without `--pretty` to undo it and a half-compact command would be incoherent. The note
here used to say that left "16 JSON sites" for #438. That was wrong by a factor of nearly three:
#438 found **42 commands** offering `--json` and 47 `JSON.stringify(…, null, 2)` calls in
`program.ts`. Corrected rather than quietly dropped, because the estimate is the kind of thing a
later ticket plans against.
