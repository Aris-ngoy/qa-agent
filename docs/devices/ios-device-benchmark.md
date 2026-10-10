# Physical iOS: benchmark against Appium and the default

## Goal

Ticket [#251](https://github.com/Aris-ngoy/qa-agent/issues/251) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233)). Measure `device-ios` ([ios-device-usbmux.md](./ios-device-usbmux.md)) against the Appium lane on the same cabled iPhone, and promote it under `auto` only if it shows a gain. Vocabulary: **Lane**, **Settle**, **Result screenshot** in [`CONTEXT.md`](../../CONTEXT.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- Same phone, same scenario, one lane at a time: iPhone 15, iOS 27.0.1, on a USB cable, home screen, 2026-10-10.
- `yoqa benchmark --lane appium|direct` is the first tool, but its tap-to-result includes the accuracy tree read. That read is the part `device-ios` cannot do yet, so a second script times the Action path alone (`performActionWithScreenshot`).
- Decision rule from the ticket: a measured gain promotes; no gain records the result and promotes nothing.

## Result: no gain, nothing promoted

Raw numbers: [`benchmark-ios-device.json`](./benchmark-ios-device.json). Harness run on Appium: [`benchmark-ios-device-appium.json`](./benchmark-ios-device-appium.json). Script: [`benchmark-ios-device-actions.ts`](./benchmark-ios-device-actions.ts).

| Metric (10 taps, after a warm-up) | Appium | `device-ios` |
| --- | --- | --- |
| tap-to-result p50 / p95 | 2639 / 2796 ms | 2892 / 3254 ms |
| action p50 | 819 ms | 904 ms |
| Settle p50 | 1585 ms | 1667 ms |
| one frame capture | 345 ms | 293 ms |
| cold start (runner already built) | 6493 ms | 3024 ms |
| tree read of the home screen | 11113 ms | no answer in 30 s |

- Tap-to-result is about 10% slower on `device-ios`. The action itself isn't faster, because XCUITest does the work either way, and Settle dominates both.
- Direct wins only on cold start and a single frame capture. Neither moves a Run's step time.
- The `snapshot` command queries each element separately, so the home screen's tree never comes back inside the link's timeout. The tree read is the Direct lane's main cost to fix, not a win to claim.

## What shipped

- No promotion: `directIsAutomatic("ios-device")` stays false, so `auto` on a phone is still Appium. Capability-pinned Cases stay on Appium either way.
- `yoqa-runner-link.ts`: a `snapshot` is given 30 s instead of 10 s (`SNAPSHOT_TIMEOUT_MS`), since a big tree legitimately takes longer than a gesture. Test in `yoqa-runner-link.test.ts`.
- `CONTEXT.md` (Lane) and the ADR-0004 considered options now record the result.

## How to verify

1. `bun test services/runner/src/domains/devices/yoqa-runner-link.test.ts`
2. With the runner stopped and a phone on a cable, unlocked: `bun run docs/devices/benchmark-ios-device-actions.ts <udid> appium 10`, then the same with `direct`.

## Follow-ups

- Make `snapshot` fast on a big tree (read one `XCUIElementSnapshot` instead of per-element queries), then re-run this benchmark. Only a gain on tap-to-result and the tree read justifies flipping `directIsAutomatic("ios-device")`.
- Settle is ~1.6 s on both lanes. A shorter Settle on the Direct lane is the lever that could make a gain, and it belongs in the lane-speed ticket, not here.
- The harness (`yoqa benchmark`) resolves a relative `--out` against the CLI's directory, not the caller's.
