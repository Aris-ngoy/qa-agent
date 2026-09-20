# Faster catalog test-case runs

## Goal

Cut wasted device I/O and fixed waits so catalog cases (AI agent and saved-script replay) finish sooner without changing how cases are written.

## Plan summary

Repeat runs already skip the vision model via saved scripts. The remaining cost was sequential observe (screenshot then tree), a second snapshot for `id`/`label` taps, a blocking report screenshot *before* every script action, Android screenshot stabilize, and an 800ms post-action settle.

Rejected: parallel cases on one device (state bleed); dropping instruction splitting (skip-ahead hallucinations); speeding `bun test` (already ~1–2s).

## What shipped

- **Agent observe overlap** — screenshot and accessibility tree run with `Promise.all` in `executeAgentCase`.
- **Cached locators** — `performAction(session, body, { elements })` reuses this step’s cleaned tree; CLI/inspector still snapshot when cache is omitted.
- **Script act-first** — replay performs the gesture, then overlaps the report PNG with settle. `id`/`label` taps prefetch the tree once.
- **`--no-stabilize`** on persisted `session.screenshot()` (same as the live inspector feed).
- **Settle default 300ms** (`POST_ACTION_SETTLE_MS`); `deps.settleMs` still overrides in tests. Agent `wait` (500–3000ms) is unchanged.

## How to verify

```bash
bun test services/runner/src/domains/runs/case-executor.test.ts
bun test services/runner/src/domains/devices/interaction.test.ts
```

On a connected device, time one script replay and one short agent case before/after (same case, same device). Script should drop the pre-step screenshot tax; agent should feel snappier between model calls.

## Follow-ups

- Adaptive settle: poll tree/fingerprint until it changes or a short cap.
- Grounding cache `(app, screen hash, description)` — see `ARCHITECTURE.md`; agent taps usually send `x,y`.
- Skip Jev on verify / make judge opt-in.
- Assert poll 400ms → 200ms.
- Combined `agent-device` screenshot+snapshot command if the CLI adds one.
