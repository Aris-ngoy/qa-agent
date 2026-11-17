# Agent output: the CLI's one emission seam

## Goal

Stop `yoqa` from being able to flood a calling agent's context window on a single screen read, and
put every byte the CLI writes for an agent behind one seam that can be bounded, measured and
guarded later.

Then measure it, so "stays inside a context window" is something anyone can check rather than a
slogan.

Then warn before the window fills, rather than after the work is lost.

Then stop charging a calling agent for whitespace on every command, not just one.

Then put every human-readable line behind the same seam, so the meter covers the whole surface and
there is one route to stdout left to guard.

Then guard it, so the seam stays single as the CLI grows.

Then teach the shipped skill to spend the budget well, and what to do when the warning fires.

Covers all seven tickets of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435):
[#442](https://github.com/Aris-ngoy/qa-agent/issues/442), the seam itself;
[#436](https://github.com/Aris-ngoy/qa-agent/issues/436), **Emitted usage** accounting and
`yoqa usage`; [#437](https://github.com/Aris-ngoy/qa-agent/issues/437), the **Output budget**
threshold warning; [#438](https://github.com/Aris-ngoy/qa-agent/issues/438), compact JSON
across every command; [#439](https://github.com/Aris-ngoy/qa-agent/issues/439), every
remaining human-readable write; [#440](https://github.com/Aris-ngoy/qa-agent/issues/440), the
guard that keeps it that way; and [#441](https://github.com/Aris-ngoy/qa-agent/issues/441), the
`yoqa-testing` skill's context-budget section.

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

**Two shapes for human-readable output, not one.** It arrived in two byte shapes: lines that
`console.log` terminated, and `script export`'s file, written raw with `process.stdout.write`
because a Case Script ends in its own newline and the shell form ends in none. The seam gained
`text` (lines, written one `console.log` each, so both the bytes and the write pattern are what
they were) and `document` (bytes, verbatim). Rejected: one `text` kind with a single newline rule,
which adds or drops a byte on one of the two export forms.

**One emission per command, not one per line.** A block or loop builds its lines and emits once, so
the ledger records one call per command, as it does for JSON. The `print*` helpers that wrote for
themselves became line builders (`devicesTableLines`, `serverTableLines`,
`resultScreenshotLines`). `script run` is the exception, as it is for `--json`: a line per step.

**`yoqa usage` accounts its own text.** It reads the total first, as its JSON form already does, so
a report never includes itself — but the next one does. Rejected: exempting it, which would make the
one unaccounted human-readable command the one that says what is accounted.

**`writeReport` has no default stdout.** Its `log` defaulted to `console.log`, a route around the
seam waiting for a caller that forgot to pass one. The default is now silence; the CLI passes
`emitText`.

**Text is accounted, not capped.** The budget warning covers it; nothing trims it.
"Byte-identical" and "capped" cannot both hold for a long `cases list`, and this was the
byte-identical batch. `formatAgentOutput` ignores `limit` for `text` and `document`.

**The guard reads source, the way the desktop's `no-react-state` test does.** It scans every
non-test file in `packages/cli/src` for the ways a file can reach stdout, and fails naming each
`file:line`, the code, which route it took, and the three `emit*` calls to use instead. Whole files
are matched, not single lines, so an import or a `stdio` array split across lines is still seen. Rejected: spying on
`console.log` and `process.stdout.write` while running every command, which only catches the
paths a test happens to drive — the regression this guards against is a new command nobody has
written a test for yet.

**Holding the stream is a write; reading its shape is not.** `process.stdout.isTTY` is a read
(`doctor-table.ts` uses it for colour), so `isTTY`, `columns` and `rows` are allowed. Anything else
that gets hold of stdout counts, because whatever holds it can write to it: `.write`,
`.pipe(process.stdout)`, `process.stdout.fd`, `{ stdout }` taken out of `process` or
`node:process`, `Bun.stdout`, `writeSync(1, …)` and `/dev/stdout`. The same goes for the
`console` methods that print to stdout, whether they are called or just passed along, as
`const log = console.log` passes one. Lines that start as a comment are skipped, because this
codebase's doc comments name `console.log` freely.

**A child process that inherits stdout is a write.** Inheriting hands the CLI's stdout to a
subprocess, which is a route around the seam that no `console` pattern sees. The guard catches
node's `stdio: "inherit"`, written as a string or an array, and Bun's `stdout: "inherit"`.

**One exemption, for one write, and it must stay true.** Foreground `yoqa serve` spawns the runner
with `stdio: "inherit"`. That is a long-lived server whose stdout is a log for a person at a
terminal, not Agent output, so it is allowed and its reason is written next to it. The exemption
names the file and the code, and it covers exactly one match. A second `stdio: "inherit",` in
`ensure-runner.ts` is still caught, even one formatted identically, which is what a match on text
alone would have let through. Review found that mistake in the first draft. A second test fails if
an exemption no longer matches any write, so one cannot outlive its site and quietly cover the
next thing to land there. Rejected: closing it by piping the runner's logs through the seam,
which would account a server log against a context window that never reads it.

**commander's own help and version are allowed, not closed.** `--help` and `--version` are written
inside commander, so no source line exists for a scan to find. Closing them means
`configureOutput({ writeOut })`, a synchronous hook in front of an async seam, which is a change
to how help is produced rather than a guard. Left as a follow-up.

**The skill says "when", because Yoqa cannot pull the levers.** Delegating to a sub-agent and
compacting belong to the harness running the calling agent. So the section tells an agent which
instrument to reach for first, and what the stderr line asks of it, and nothing more. It is one
section in `SKILL.md`, a dozen lines, because that file loads into every consuming agent's context.
Rejected: a new reference file. It would hold guidance the agent needs before its first read, so
it would have to be pointed at from the entry point anyway, and the pointer would cost about as
much as the section.

**The instruments are ranked by what they cost, not by what they show.** That order is cleaned
tree, small Agent image, full Agent image, raw tree. `yoqa screenshot` is named beside the full
Agent image because it saves the raw frame, and the targeting ladder starts from it. It is a different ladder from the targeting
ladder, which ranks by what reaches a target and puts the screenshot first. The two coexist. The
targeting ladder decides how to find a control. The budget decides which read to take when either
would answer.

**`--scale 0.2`, not `0.5`.** `--scale` multiplies the raw frame, while the default Agent image
caps the long edge near 1000 px. On a 2796 px iPhone frame, `0.5` gives a 1398 px image, which is
*larger* than the default. `0.2` lands near 500 px on common phones, a quarter to a third of
the default's tokens. "~600 tokens on a phone" is #436's `width × height / 750` on a 1000 × 460 frame.

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

### Every remaining write (#439)

- All 96 `console.log` and `process.stdout.write` calls left in `program.ts` now go through one of
  three calls in `command-output.ts`: `emitJson`, and the new `emitText` and `emitDocument`. The
  three share one `emitContext`, so the name and Device Session the ledger credits are worked out
  once. Outside `agent-output.ts`, nothing in `packages/cli/src` writes to stdout.
- Human-readable output is **byte-identical**: stdout, stderr and exit code, for every command (see
  *How to verify*).
- Every command run with a `--base-url` and a Device Session now records under its own name, in
  either form. That means one more memoized `GET /devices/active` per human-readable command. It
  happens after the output is written, and it gives up after 2 s.
- `script validate` and `skill install` are offline, as they were for #438: written through the
  seam, and not accounted.
- Tests: a root `bunfig.toml` preloads `packages/cli/src/test-preload.ts`. That points
  `YOQA_EMITTED_USAGE_PATH` at a temp file for any test that has not set its own. Every command now
  accounts, so a test that runs one against a fake runner with a Device Session would otherwise
  write to the developer's own `~/.yoqa`.
- The ticket asked that existing tests pass unchanged. Two things did change:
  - The fakes in `action-key.test.ts` and `app-web-url.test.ts` now answer `/devices/active` with a
    404, where they used to throw on a body-less GET. No assertion changed in either file.
  - In `emitted-usage-command.test.ts`, the second `usage` warning now quotes 35 tokens where it
    quoted 12. The difference is the 23-token report that the first `usage` printed. That follows
    from the `usage` decision above.

### The guard (#440)

- `packages/cli/src/no-direct-stdout.test.ts` — three tests: no stdout write outside
  `agent-output.ts` except the named exemption; every exemption still names a real write; and the
  scan actually reached `program.ts` and the seam, so a moved directory cannot make it pass by
  scanning nothing. Each route to stdout is a named pattern, so a failure says which one tripped.
- It passes on the current tree with no code change: #439 had already moved every site.
- A failure reads like this:

```
+ [
+   "program.ts:2457  console.log(\"x\");  — a console method that prints to stdout; write through emitText, emitJson or emitDocument in command-output.ts",
+ ]
```

- **What it cannot see.** The guard matches text, not types. It catches every route listed above,
  but it is not a proof:
  - an alias made a step removed, such as `const c = console; c.log(…)` or `const p = process;
    p.stdout`, gets through;
  - so does a write in a package the CLI imports, because only `packages/cli/src` is scanned
    (`@yoqa/runner-client` has no stdout writes today);
  - so does commander's own help output.

  The guard exists to stop the easy mistake, a new command that calls `console.log`, and that is
  the mistake it catches.
- **False positives, accepted.** `stdio: ["inherit", "pipe", "pipe"]` inherits only stdin and is
  still flagged, because the guard does not work out which slot inherits. A trailing
  `foo(); // console.log(x)` is flagged too, because only lines that start as a comment are
  skipped. A site that really needs either takes an exemption and a reason.

### The skill's context budget (#441)

- `packages/skill/yoqa-testing/SKILL.md` gains **Context budget**, between Conventions and When
  blocked. It covers the four instruments in cost order, `action batch` as one Settle and one
  Result screenshot for a known sequence, long sweeps in a sub-agent that reports a short verdict,
  `yoqa usage`, and what the `Yoqa has emitted N of M tokens …` line asks for.
- `references/inspect-and-app-control.md` had a half-sentence saying the tree "costs fewer tokens
  than an image". It now links to the section, so the comparison lives in one place.
- The entry point grew from 5,498 to 6,357 bytes, about 200 tokens.
- `.agents/skills/yoqa-testing` is updated in step, which `skill-docs.test.ts` requires.

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

bun test packages/cli/src/no-direct-stdout.test.ts      # the one stdout writer: nothing outside the seam
bun test packages/cli/src/skill-docs.test.ts            # the skill's commands exist; local copy matches
```

To see the guard fail, add `console.log("x");` to any function in `packages/cli/src/program.ts`
and rerun it: the failure names the line. Each route was checked that way, one probe file at a
time, and all 16 of these failed the guard:
- `console.log(…)`, `console.table(…)`, `const log = console.log` and `.forEach(console.info)`
- `process.stdout.write`, `process["stdout"].write`, `.pipe(process.stdout)` and
  `writeSync(process.stdout.fd, …)`
- `const { stdout } = process`, and a multi-line `import { stdout } from "node:process"`
- `Bun.write(Bun.stdout, …)`, `writeSync(1, …)` and `Bun.file("/dev/stdout")`
- `stdio: "inherit"` as a string, as a multi-line array, and as Bun's `stdout: "inherit"`

None of these failed it:
- `process.stdout.isTTY` and `.columns`
- a commented-out `console.log`, and a doc comment that names one
- an `execFile` callback's `stdout` parameter, and `const { stdout } = await run()`
- `console.error`

Two more checks went the right way. Adding a second, identical `stdio: "inherit",` to
`ensure-runner.ts` failed the guard. Removing the exempt one failed the stale-exemption test.

Human-readable output, against any runner with a device connected:

```bash
yoqa devices active && yoqa usage   # `devices active` appears in the breakdown
yoqa usage && yoqa usage            # the second report counts the first
```

#439's byte-identity check was a throwaway harness, deliberately not committed (#440's guard is
the durable check). It ran 58 human-readable invocations as `bun run packages/cli/src/main.ts`
subprocesses against a `Bun.serve` fake runner, on `main` and on the branch. Each got its own temp
ledger and `NO_COLOR=1`, and temp paths and the port were normalized out. Result:
- stdout, stderr and exit code were identical in **58/58**.
- **54/58** wrote a ledger row. The four that did not: `cases list --tag` with no match, which
  prints nothing; `script validate` twice; and `skill install`.
- To show the harness could fail, a mutant seam that dropped the last line of every `text` payload
  was caught in 20 commands.

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

Verified against the real runner, with `YOQA_EMITTED_USAGE_PATH` pointed at a temp file so the run
left nothing in `~/.yoqa`. `yoqa health` bare is 1 line and 6 with `--pretty`; `yoqa status --json`
is 1 and 12; `jq -S` over both shows no difference. With nothing connected, `yoqa usage` says there
is no Device Session and no ledger file is created at all — the documented "every command *can*
contribute". With a Browser device connected, five commands in a row give the breakdown this
ticket's whole point:

```
Emitted 2,632 of 250,000 tokens (1%) — Device Session web-chrome@1794916201738
  devices ios       2,126 (1 call)
  screen              395 (1 call)
  status               84 (1 call)
  health               19 (1 call)
  action open-url       8 (1 call)
```

Before this ticket only the `screen` row existed. `devices ios` costing 2,126 tokens — eighty times
`action open-url`, five times `screen` — is the sort of thing the breakdown could not show.

## Follow-ups

With #441, every ticket of [#435](https://github.com/Aris-ngoy/qa-agent/issues/435) has shipped.

**The skill's cost order is ahead of the meter.** The section ranks Agent images by what they cost.
`yoqa usage` does not count them yet, because the image arm of the estimator has no call site (see
below). So a session heavy on screenshots reads low on the meter, and its warning fires late. The
skill line stays true once images are priced. It is the meter that has to catch up.

**Every command can now trigger the budget warning**, in either form. Since #439, a session's
total is the cost of everything Yoqa's own code wrote to stdout.

**Two routes to stdout are not Yoqa's code, and #440's guard allows both rather than closing them.**
- commander writes `--help`, `<command> --help` and `--version` itself. These are unaccounted, and
  an agent reads help often. Routing help through `configureOutput({ writeOut })` is the obvious
  fix, but it is a synchronous hook in front of an async seam.
- Foreground `yoqa serve` starts the runner with `stdio: "inherit"` (`ensure-runner.ts`), so the
  runner's logs reach the CLI's stdout. This one is a named exemption in the guard, and deliberate:
  a server log is not Agent output.

**The image arm of the estimator has no call site yet.** `estimateImageTokens` is in #436's
acceptance criteria and ships tested, and the seam prices any payload that names an Agent image —
but no payload through the seam names one yet. #436 expected `action --screenshot` to carry the
first one when #439 moved it onto the seam. It did not: #439 moved the action's *lines* across, and
the `screenshot <path>` line is priced as text. Pricing the image means reading the PNG's
dimensions at that call site, which nothing does today, and a byte-identical batch was the wrong
place to add a read. The Agent image is still the largest cost the meter does not see.

**Offline commands record nothing.** `script validate` and `skill install` have no runner to ask
for a Device Session. If they ever matter, they need a session they can find without a runner.

**The text estimate leaves out line terminators.** `text` is priced on its lines joined by `\n`,
so the newline `console.log` adds after each line is not counted. JSON is priced the same way, so
the two are consistent. Each such line undercounts by under a token.

**`servers list|stop|restart|stop-all --base-url <url>` ignores the flag.** The parent `servers`
command takes `--base-url` before the subcommand sees it, so the subcommand talks to the default
runner. This predates #439; the harness found it. It needs its own ticket.

**`script run --json` reads the ledger once per action.** Each emission appends and then reads back
to compute the running total (#437). A twenty-action replay is twenty reads of a file capped at
1 MB, each after its line is already on stdout, against twenty HTTP round-trips and 800 ms of
settle time per action — noise next to the work, but named rather than left to be found in a
profile.

**Nothing prunes old sessions' records.** The 1 MB compaction drops them only when the file grows
past the cap, so a long-lived ledger keeps dead sessions until then. Age-based pruning, the way
`pruneOldRunScreenshots` does it, would be the obvious next step if that ever matters.

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
