# Branch: conditional steps in a Case Script

Spec: [Aris-ngoy/qa-agent#321](https://github.com/Aris-ngoy/qa-agent/issues/321). Tracer bullet: [#323](https://github.com/Aris-ngoy/qa-agent/issues/323). Client-side replay: [#324](https://github.com/Aris-ngoy/qa-agent/issues/324). `id` target and `yoqa assert --id`: [#325](https://github.com/Aris-ngoy/qa-agent/issues/325). Desktop and Run reports: [#327](https://github.com/Aris-ngoy/qa-agent/issues/327). Decision: [ADR-0008](../adr/0008-case-script-branches.md). Terms: **Branch**, **Case Script**, **Case Script file** in [`CONTEXT.md`](../../CONTEXT.md). The file format is described in [case-script-yaml.md](./case-script-yaml.md).

## Goal

Let a script author tap through UI that only sometimes appears, in one Case Script, and see in the Run timeline which path a Run took.

## Plan summary

- **Model, not only file.** `branch` joins the catalog's Case Script action union, so the list is recursive (a lazy zod schema). `version` stays `1`.
- **Fields.** exactly one target, `text` or `id`; `assertion` `visible` | `not-visible` (default `visible`), `timeoutMs` 0–120000 (default 2000 when absent), `then` (at least one step), optional `else` (an empty list reads as absent), `reason`. Branches nest; there is no `else-if`.
- **Check.** The Branch uses the same Screen check as `assert` (`checkScreen`): it polls the cleaned Screen tree until the target is visible / not visible (→ `then`) or the deadline passes (→ `else`). A `text` matches like `assert` (substring of a label or type); an `id` matches like a tap by id (`findElementById`: exact and case-insensitive, and a short id such as `get_bonus` also matches `com.app:id/get_bonus`), so a Branch on an id finds exactly the element a `tap: { id: … }` would hit.
- **`id` in the model, not only the file.** Both `text` and `id` are optional fields of the `branch` schema, with a refinement that exactly one is set. A discriminated `{ text } | { id }` type was rejected: the recursive lazy schema has to type-check against the hand-written `CaseScriptBranch`, and two optional fields keep every reader (`action.id != null ? … : …`) simple.
- **Rejected:** flat `optional:` flags on single actions, `else-if` chains, and conditions other than Screen presence (see the ADR).

## What shipped

**Case Script file (`*.yoqa.yaml`)**

```yaml
actions:
  - if:
      text: Allow notifications
      timeoutMs: 3000
      then:
        - tap: Allow
      else:
        - wait: 500
  - if: { label: Not now, then: [tap: Not now] }
  - if:
      id: onboarding-skip
      then:
        - tap: { id: onboarding-skip }
```

- The item key is `if`; the model type is `branch`. A Branch takes exactly one of `text` (or its alias `label`) and `id`; both, or neither, fail import with the line and nested position (``Line 10, action 2 → then → action 1: if: write `text` or `id`, not both``). `label` is read as `text`; the exporter always writes `text`. There is no short form (`- if: Allow` is an error).
- `then` / `else` hold ordinary file items, so short forms work inside them. A legacy `.yoqa.json` carries `type: "branch"` with `then` / `else` arrays.
- The exporter writes `then:` / `else:` as block lists, one action per line, and the output re-imports unchanged. Comments inside branches survive the file round-trip (not a save to the catalog, as before).
- Errors name the line and the nested position: `Line 24, action 6 → then → action 2 → else → action 1: unknown action "tapp" …`. A missing or empty `then`, a missing target (``needs `text:` or `id:` ``), and an unknown key inside `if` all fail import.

**Case executor (Runs)**

- Script replay walks the list recursively. On a Branch it checks the Screen, appends one Run step, then replays the chosen side in place, continuing the step index. The side not taken appends nothing.
- The Branch step records `{ type: "branch", text | id, assertion, timeoutMs, outcome: "then" | "else", reason, thoughts }`, `ok: true`, a screenshot taken when it decided, `detail` like `visible: Allow notifications → then` (or `visible id: onboarding-skip → then`), and the equivalent `yoqa assert visible --text '…' --timeout 2` (or `--id '…'`) as its command. The Run timeline and report show it as `If visible: Allow notifications → then` / `If visible id: onboarding-skip → then`.
- A failure inside a side fails the case like a top-level failure. A Screen that is still unreadable at the deadline fails the case with the read error (it does not take `else`). A Dead Session ends the case at once. Abort works while the check polls and between the actions of a side.

**Client-side replay (`yoqa script run`, the Inspector's Run)**

- `runCaseScript` follows a Branch the way the Case executor does: the same `checkScreen`, then the chosen side in place. A failure inside a side, a Screen still unreadable at the deadline, and abort (during the check or between the steps of a side) end the replay as they do for an assert.
- Each replay event carries a `path` (`{ index, nested: [{ side, index }] }`, 0-based) next to the top-level `index`, and a `position` out of `total`. The Branch emits its own `running` / `ok` events; its `ok` carries `outcome: "then" | "else"`.
- `total` counts steps run plus those still to come; it grows by the side's length when a Branch decides. The side not taken is never reported; after a failure, the rest of the side and of the script are reported `skipped` (a Branch not reached is one skipped step). A failed result adds `failedPath`.
- `defaultBranchTimeoutMs` (default 2000) sits next to `defaultAssertTimeoutMs`.
- `yoqa script run` prints `ok if visible: Allow notifications → then (2/4)` (`if visible id: onboarding-skip → then` for an id), indents the side's steps, and names a failed step by its path (`action 2 → then → action 1 failed: …`); exit status is as for a flat script. `--json` lines gain `path` and `outcome`. The closing line now counts steps (`done 4 steps`).
- The Inspector's run log and session report show the Branch with its outcome and each step of the side (indented). While a side runs, the editor keeps the Branch's `if:` line highlighted; a failure inside a side reads `Line 4, action 2 → then → action 1: …`.

**`yoqa assert --id`**

- `yoqa assert visible|not-visible` takes `--id <id>` as an alternative to `--text` (exactly one; both or neither prints a usage error and exits 1 without reading the Screen). A failed assert still exits non-zero; the message names the id (`Expected visible id not found within 5s: onboarding-skip`).
- The shell-script runner (`runYoqaShellScript`, used by the Inspector and the CLI) accepts `yoqa assert … --id '…'` lines and rejects a line with both flags. Converting a shell script to a Case Script skips an `assert --id` with a warning, since a Case Script `assert` only takes text.

**Elsewhere**

- Shell export writes `if yoqa assert … --text|--id '…' --timeout <s>; then … else … fi`, indented.
- The Inspector step list and the Test Case script summary show a Branch as one row, e.g. `If “Allow notifications” visible → 1 step, else 2 steps` (`not visible` for a `not-visible` Branch; a nested Branch counts as one step of its side). An id reads `id “onboarding-skip”` in the Inspector and `#onboarding-skip` in the summary (as a tap by id does). Both read the wording from one helper, `describeBranch` in `features/test-cases/utils/script-summary.ts`. Editing a Branch stays in the Inspector's YAML editor; there is no structured branch editor.
- A Run report (HTML, Markdown, GitHub summary) lists each Branch step as `If visible: Allow notifications → then`, with its `yoqa assert … --timeout` command, reason, detail and the screenshot it decided on, followed by the steps of the side that ran.
- Building a Case Script from agent decisions is typed to flat Actions, so a recorded script never contains a Branch.
- Biome's `noThenProperty` rule is off: a Branch's `then` is a list, never a function, so it can't make an object thenable.

## How to verify

1. `bun test apps/desktop/src/mainview/features/test-cases/utils/script-summary.test.ts apps/desktop/src/mainview/features/inspector/utils/script-steps.test.ts packages/runner-client/src/run-report.test.ts packages/runner-client/src/case-script-file.test.ts packages/runner-client/src/case-script-replay.test.ts services/runner/src/domains/runs/case-executor.test.ts packages/runner-client/src/script-format.test.ts packages/runner-client/src/shell-script.test.ts packages/runner-client/src/screen-check.test.ts packages/cli/src/assert-id.test.ts`
2. `yoqa script validate` a file with an `if:` item: it prints `ok`. Remove its `then:` and it prints `Line N, action M: if: needs \`then:\` with at least one action`.
3. With a device connected, `yoqa script run` that file: it prints the Branch with `→ then` or `→ else` and only that side's steps, and exits 0 (or 1 when a step fails). The Inspector's Run shows the same in its log.
4. With a device connected, `yoqa assert visible --id <an id on the Screen>` prints `ok assert visible`; a missing id exits 1, and `--text x --id y` is rejected.
5. Import that file into a Test Case: its Script tab shows the Branch as one `If “…” visible → n steps, else m steps` row. Run it in script mode on a device. The Run details show an `If visible: … → then` (or `→ else`) step, followed only by the steps from that side, and **Export HTML** shows the same.

## Follow-ups

- `CONTEXT.md`'s **Branch** entry still says "for one text"; it should read "for one text or id".
- A Case Script `assert` on an id (so shell import of `yoqa assert --id` need not skip it).
- A Run step does not record which side it ran in, so a Run report lists a side's steps flat after their Branch step (no indent, unlike the CLI and Inspector logs).
- Line-by-line highlighting of a Branch's inner steps in the Inspector (the parser keeps top-level `actionLines` only, so a side's steps highlight their `if:` line).
