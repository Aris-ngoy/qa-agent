# iOS Direct: axbridge Screen, system modal, Settle, vs-Appium gate

## Goal

The iOS Direct Screen includes RN / web content and **system** dialogs, Settle runs on companion screenshot frames, and the benchmark harness can prove the simulator gate against Appium. Ticket [#199](https://github.com/Aris-ngoy/qa-agent/issues/199). Vocabulary: **Lane**, **Settle**, **Screen** in [`CONTEXT.md`](../../CONTEXT.md). Spike: [idb-companion-spike.md](./idb-companion-spike.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- `idb ui describe-all --api axbridge --format complete` is the tree. `cleanPageSource` accepts that JSON (not only Appium XML) and lifts `modal` onto the Screen — the default flat AX array misses SpringBoard alerts (Maps location: `kind=system`).
- Adaptive Settle already polls `captureFrame`. The frame source is `idb screenshot`, falling back to `xcrun simctl io screenshot` when companion reports “no active display”.
- `acceptAlert` / `dismissAlert` tap Allow / Don’t Allow from that Screen.
- Rejected: inventing a vs-Argent p50. The public `argent` CLI is still MCP/flow (`yoqa benchmark --tools argent` skips).

## What shipped

- `cleanPageSource` parses idb complete JSON and keeps `modal.label` plus axbridge buttons
- iOS Direct Settle test on companion PNG frames
- `acceptAlert` taps `Allow While Using App` / `Allow` / `OK` from the Screen
- Tests: Maps modal on Screen; getScreen; Settle; acceptAlert
- Live harness: [`benchmark-ios-direct.json`](./benchmark-ios-direct.json) — Direct tapToResult p50 **2044 ms** / screenRead **528 ms** / tapAccuracy **1.00** vs Appium **3137 / 5243 / 1.00** on the same iPhone 17 Pro / iOS 26.5 sim. Cold start **676 ms** vs Appium **85 s**. Settle used `simctl` after companion screenshot said “no active display”.

## How to verify

1. `bun test services/runner/src/domains/devices/screen.test.ts services/runner/src/domains/devices/ios-direct-lane.test.ts services/runner/src/domains/devices/interaction.test.ts`
2. On a simulator with a permission sheet: `yoqa devices connect … --lane direct` then `yoqa screen --json` — elements include the modal title and Allow / Don’t Allow when axbridge reports them.
3. `yoqa action tap --x 500 --y 500 --screenshot` on Direct — `phases settle=…` from companion frames.
4. Gate (same simulator, companion installed):

```bash
yoqa benchmark --device <udid> --platform ios --lane direct --repeats 3 --out docs/devices/benchmark-ios-direct.json
yoqa benchmark --device <udid> --platform ios --lane appium --repeats 3
```

Direct `tapToResult` p50 must be below Appium; `tapAccuracy` must not drop. Recorded: 2044 vs 3137, accuracy 1.00 both. Spike idb CLI (no Settle) was 396 ms ([benchmark-idb-spike.json](./benchmark-idb-spike.json)).

## Follow-ups

- vs-Argent when that CLI can drive taps.
- Companion screenshot “no active display” — simctl fallback works; a companion restart may restore the faster idb shot.
- Hardware Case on a simulator for [#198](https://github.com/Aris-ngoy/qa-agent/issues/198).
