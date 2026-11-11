# One act-and-Settle for Runs and the connector

Terms: **Action**, **Settle**, **Result screenshot**, **Agent image**, **Tree assist**, **Escalation**, **Run**, **Case executor** in [`CONTEXT.md`](../../CONTEXT.md). Builds on [ADR-0003](../adr/0003-case-executor-test-seam.md) (the Case executor is the Run test seam) and [one-case-script-replay.md](./one-case-script-replay.md) (#426).

## Goal

CONTEXT.md says a Settle waits after an Action until the screenshot stops changing, up to a cap, and that a fixed delay is not a Settle. The connector already did that. Runs did not: they slept `POST_ACTION_SETTLE_MS = 800` after every Action, then took a second capture. The agent loop also judged "screen unchanged" (Tree assist, Escalation, stall hints) with its own `screenshotFingerprint`. On top of that, a test-only global (`setCaseSettleMsForTests`) changed Run timing, and `devices/action-result.ts` imported `runs/coord-grid`.

Goal: one deep module that performs an Action, Settles, and returns the Result screenshot. The connector, the agent loop and Case Script replay all use it, and they share one meaning of "unchanged".

## Plan summary

- **The module is `actAndSettle(session, body, options)`** in `devices/action-result.ts`. It performs the Action, polls `session.captureFrame()` until the frame holds still for the stable window or the cap passes, and returns `{ response, result, actionMs }`. `result` is the Result screenshot frame: `base64`, `settled`, `waitedMs`, `frozen?`, and `changed: boolean | null`, judged against the frame from before the Action. It stores no files. Each caller decides what to keep.
- **One Settle policy** (`DEFAULT_SETTLE_POLICY`): cap 1500 ms, poll 80 ms, stable window 160 ms. These are the connector's existing values, now used by Runs too.
- **One notion of "unchanged"**: `screenChanged(previous, frame)` compares fingerprints (`screenFingerprint`, i.e. `Bun.hash`). It returns null when nothing came before, when the screen never settled, or when the frame is frozen. The connector's `changed` uses it. So do Escalation, Tree assist and the repeat-tap and stuck-wait hints, which count a step as unchanged only when `changed === false`. A wait's plain capture is treated as a still frame. Settle's own frame-to-frame check uses the same fingerprint. Both sides needed the same thing, so nothing called for two meanings. One side effect: a frozen screen (a web JavaScript dialog) no longer counts toward Tree assist or Escalation, since its frame shows nothing either way. `lastSwipeMovedScreen` treats "unknown" as moved, so a scroll goal keeps scrolling. That matches the old behaviour, because an animating frame always differed.
- **Seam**: the Case executor deps take `clock` (already there) and `settle?: Partial<SettlePolicy>` in place of `settleMs`. The agent loop also takes `screenshotDir?` for where Result screenshots are stored. `runs/application.ts` passes neither and gets the defaults. The test global is gone.
- **Agent loop**: after an Action, the step's screenshot *is* the Result screenshot. It is written with `saveResultScreenshot`, and the loop no longer calls `session.screenshot()` again. The first step and steps after a wait or an assert still capture with `session.screenshot()`.
- **Case Script replay**: the adapter's `performAction` calls `actAndSettle` and returns its `response`. Nothing else changes there. The pre-step screenshot stays where #426 put it.
- **coord-grid split**: the PNG codec moved to `devices/png.ts`, and the Action marks to `devices/action-marks.ts`. `runs/coord-grid.ts` keeps the grid and imports the codec from devices, so runs depends on devices and not the other way round. It re-exports `decodePng` / `encodeRgbaPng` for the lane test harnesses that other work is editing now.
- Rejected:
  - *A separate, shorter Run cap.* The task was one policy, close to the connector's. A game that never settles now waits 1500 ms instead of 800 ms (see timing below).
  - *Settling via `session.screenshot()`.* It writes a file on every poll.
  - *Injecting a whole `actAndSettle` function at the seam.* That would be a shallow pass-through. The policy and clock are the real variables.
  - *Persisting inside `actAndSettle`.* Script replay does not use the Result frame, so it would write files no one reads.

## What shipped

- `devices/action-result.ts`: `SettlePolicy`, `DEFAULT_SETTLE_POLICY`, `screenFingerprint`, `screenChanged`, `actAndSettle`, `saveResultScreenshot`. `performActionWithScreenshot` is now the connector's adapter: `actAndSettle`, then the raw, marked and Agent-image files. `settleScreen` takes `Partial<SettlePolicy>`, which keeps its signature the same for the lane tests.
- `runs/case-executor.ts`: `POST_ACTION_SETTLE_MS` and both `clock.sleep(settleMs)` sites are removed. `applyDecision` returns the `ActAndSettleResult`. The Escalation, Tree assist and hint counters read `changed`. The step's `actionMs` / `settleMs` phases come from the module.
- `runs/agent.ts`: `screenshotFingerprint` is removed.
- `runs/application.ts`: `setCaseSettleMsForTests` is removed. `web-run.test.ts` runs against a real Settle (about 3 s for the file).
- `devices/png.ts` and `devices/action-marks.ts` are split out of `runs/coord-grid.ts`.
- Tests: the `settleScreen` cases in `action-result.test.ts` are replaced by `actAndSettle` cases run through its interface with a fake clock and fake frame sequence: settles, window reset, never settles at the cap, background `capturedAt`, zero cap, frozen, and last-Result fallback. In `case-executor.test.ts`, `settleMs` becomes `settle`. The fakes gain `captureFrame`. The Escalation and Tree-assist tests use an advancing fake clock, and their changing screens now change per Action instead of per capture.

### Timing changes expected

| Case | Before | After |
|------|--------|-------|
| Still screen after an Action | 800 ms sleep, plus one extra capture | First frame, then one stable window: about 160–240 ms plus the time to capture 3 frames |
| Transition (navigation, sheet) | 800 ms, plus capture, even if the transition took longer | Waits until it is over, up to 1500 ms |
| Never-settling screen (a game, video, spinner) | 800 ms, plus capture | 1500 ms cap, plus captures taken during the cap. **Slower** by up to about 700 ms per Action |
| Script replay step | 800 ms | Same as the rows above, by screen |

On a slow capture source (simctl at about 250 ms a frame), a still screen settles in about 3 captures, around 600 ms. That is still under 800 ms plus the old extra capture.

## How to verify

1. `bun run lint:ci && bun run check && bun run test`.
2. `bun test services/runner/src/domains/devices/action-result.test.ts services/runner/src/domains/runs/case-executor.test.ts`.
3. **Required manual check before merge (device benchmark gate, not run here):**
   - Connector path, which should be unchanged: `yoqa benchmark --device <id> --platform ios` (and `--platform android`), compared against the committed `docs/devices/benchmark-*.json`. See [devices/benchmark.md](../devices/benchmark.md).
   - Run path: run the same catalog Test Case (one ordinary app and one game) on a real device before and after this change. Compare the step `settle` phase and the total Run time in the Run report (`settle Nms` in `yoqa run` output or the desktop report). Expect ordinary apps to be faster, and games up to about 700 ms per Action slower.

## Follow-ups

- Point `devices/lane-harnesses.ts`, `devices/fake-cdp.ts` and the lane tests that import `encodeRgbaPng` / `decodePng` from `../runs/coord-grid` at `devices/png.ts`, then drop the re-export. They were left alone because other work is editing them.
- If the game slowdown matters in the benchmark, give a known game a shorter cap through the same `settle` seam. A game is already detected per case.
