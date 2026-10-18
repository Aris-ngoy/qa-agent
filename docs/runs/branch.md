# Branch: conditional steps in a Case Script

Spec: [Aris-ngoy/qa-agent#321](https://github.com/Aris-ngoy/qa-agent/issues/321). Tracer bullet: [#323](https://github.com/Aris-ngoy/qa-agent/issues/323). Decision: [ADR-0008](../adr/0008-case-script-branches.md). Terms: **Branch**, **Case Script**, **Case Script file** in [`CONTEXT.md`](../../CONTEXT.md). The file format is described in [case-script-yaml.md](./case-script-yaml.md).

## Goal

Let a script author tap through UI that only sometimes appears, in one Case Script, and see in the Run timeline which path a Run took.

## Plan summary

- **Model, not only file.** `branch` joins the catalog's Case Script action union, so the list is recursive (a lazy zod schema). `version` stays `1`.
- **Fields.** `text` (the only target for now), `assertion` `visible` | `not-visible` (default `visible`), `timeoutMs` 0–120000 (default 2000 when absent), `then` (at least one step), optional `else` (an empty list reads as absent), `reason`. Branches nest; there is no `else-if`.
- **Check.** The Branch uses the same Screen check as `assert` (`checkScreen`): it polls the cleaned Screen tree until the text is visible / not visible (→ `then`) or the deadline passes (→ `else`).
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
```

- The item key is `if`; the model type is `branch`. `label` is read as `text`; the exporter always writes `text`. There is no short form (`- if: Allow` is an error).
- `then` / `else` hold ordinary file items, so short forms work inside them. A legacy `.yoqa.json` carries `type: "branch"` with `then` / `else` arrays.
- The exporter writes `then:` / `else:` as block lists, one action per line, and the output re-imports unchanged. Comments inside branches survive the file round-trip (not a save to the catalog, as before).
- Errors name the line and the nested position: `Line 24, action 6 → then → action 2 → else → action 1: unknown action "tapp" …`. A missing or empty `then`, a missing `text`, and an unknown key inside `if` all fail import.

**Case executor (Runs)**

- Script replay walks the list recursively. On a Branch it checks the Screen, appends one Run step, then replays the chosen side in place, continuing the step index. The side not taken appends nothing.
- The Branch step records `{ type: "branch", text, assertion, timeoutMs, outcome: "then" | "else", reason, thoughts }`, `ok: true`, a screenshot taken when it decided, `detail` like `visible: Allow notifications → then`, and the equivalent `yoqa assert visible --text '…' --timeout 2` as its command. The Run timeline and report show it as `If visible: Allow notifications → then`.
- A failure inside a side fails the case like a top-level failure. A Screen that is still unreadable at the deadline fails the case with the read error (it does not take `else`). A Dead Session ends the case at once. Abort works while the check polls and between the actions of a side.

**Elsewhere (fallbacks until the follow-ups land)**

- Client-side replay (`yoqa script run`, the Inspector's Run) stops at a Branch with "This replay can't follow a Branch yet; run the Test Case in a Run".
- Shell export writes `if yoqa assert … --timeout <s>; then … else … fi`, indented.
- The Inspector step list and the Test Case script summary show a Branch as one row, e.g. `If “Allow notifications” visible → 1 step, else 2 steps`.
- Building a Case Script from agent decisions is typed to flat Actions, so a recorded script never contains a Branch.
- Biome's `noThenProperty` rule is off: a Branch's `then` is a list, never a function, so it can't make an object thenable.

## How to verify

1. `bun test packages/runner-client/src/case-script-file.test.ts services/runner/src/domains/runs/case-executor.test.ts packages/runner-client/src/script-format.test.ts`
2. `yoqa script validate` a file with an `if:` item: it prints `ok`. Remove its `then:` and it prints `Line N, action M: if: needs \`then:\` with at least one action`.
3. Import that file into a Test Case and run it in script mode on a device. The Run details show an `If visible: … → then` (or `→ else`) step, followed only by the steps from that side.

## Follow-ups

- An `id` target (exact, case-insensitive, like a tap by id) and `yoqa assert --id`.
- Client-side replay (CLI and Inspector) follows Branches, with step paths in its events and a default Branch timeout option.
- Line-by-line highlighting of a Branch's inner steps in the Inspector.
