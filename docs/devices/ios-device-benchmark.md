# Physical iOS: benchmark against Appium and the default

## Goal

Ticket [#251](https://github.com/Aris-ngoy/qa-agent/issues/251) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233)). Measure `device-ios` ([ios-device-usbmux.md](./ios-device-usbmux.md)) against the Appium lane on the same cabled iPhone, and promote it under `auto` only if it shows a gain. Vocabulary: **Lane**, **Settle**, **Result screenshot** in [`CONTEXT.md`](../../CONTEXT.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- Same phone, same scenario, one lane at a time: iPhone 15, iOS 27.0.1, on a USB cable, home screen, 2026-10-10.
- `yoqa benchmark --lane appium|direct` is the first tool, but its tap-to-result includes the accuracy tree read. That read is the part `device-ios` cannot do yet, so a second script times the Action path alone (`performActionWithScreenshot`).
- Decision rule from the ticket: a measured gain promotes; no gain records the result and promotes nothing.

## Result

Raw numbers: [`benchmark-ios-device.json`](./benchmark-ios-device.json) (`before` and `after`). Harness run on Appium: [`benchmark-ios-device-appium.json`](./benchmark-ios-device-appium.json). Script: [`benchmark-ios-device-actions.ts`](./benchmark-ios-device-actions.ts) (taps the status bar, so run it with the Settings app in front).

**Before (first run, home screen): no gain.** Direct tap-to-result p50 was 2892 ms against Appium's 2639 ms, and the home-screen `snapshot` never answered inside 30 s (Appium: 11 s). `PhoneDevice.snapshot` resolved `query.element(boundBy:)` for every element, and each one re-queries the app, so the cost grew with the square of the tree.

**After one `XCUIElement.snapshot()` per read.** Static screen (Settings), 10 taps after a warm-up, two runs per lane:

| Metric | Appium | `device-ios` |
| --- | --- | --- |
| tap-to-result p50 / p95 | 2631 / 2651 ms, 2624 / 2652 ms | 1093 / 1248 ms, 1104 / 1422 ms |
| action p50 | 763 ms | 645 ms |
| Settle p50 | 1577 ms | 329 ms |
| one frame capture | 339 ms | 117 ms |
| cold start (runner already built) | 5.8 s | 2.8 s |
| tree read | 11113 ms | 377 ms |

The harness (`yoqa benchmark`, home screen) now completes on Direct: tap-to-result p50 3179 ms against 13145 ms, screen read 377 ms against 11113 ms, tap accuracy 1.00 on both.

- Direct is 2.4x faster per tap and about 30x faster at reading the tree.
- Settle is the largest part. On Appium it always ran to its 1.5 s cap on a static screen; on Direct two identical frames come back in about 330 ms because a frame is 117 ms instead of 339 ms.
- On the home screen the Clock icon's second hand changes the frame, so Settle runs to its cap on both lanes. That is Settle working, not a lane fault.

## What shipped

- `PhoneDevice.swift`: `snapshot` reads one `XCUIElement.snapshot()` and walks its children in document order.
- `yoqa-runner-link.ts`: a `snapshot` gets 30 s instead of 10 s (`SNAPSHOT_TIMEOUT_MS`). Test in `yoqa-runner-link.test.ts`.
- **`auto` is not promoted yet.** (Superseded: promoted in [ios-device-default.md](./ios-device-default.md).)

## How to verify

1. `bun test services/runner/src/domains/devices/yoqa-runner-link.test.ts`
2. With the runner stopped and a phone on a cable, unlocked: `bun run docs/devices/benchmark-ios-device-actions.ts <udid> appium 10`, then the same with `direct`.

## Follow-ups

- Decide whether `auto` picks `device-ios` on a cabled phone. That is one line in `select-lane.ts` plus its tests, and the benchmark above is the evidence. Capability-pinned Cases stay on Appium either way.
- Appium's Settle never settles on a static screen (every frame differs). That is a likely Appium-lane win, not part of this change.
- The harness (`yoqa benchmark`) resolves a relative `--out` against the CLI's directory, not the caller's.
