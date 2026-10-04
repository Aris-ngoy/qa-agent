# Appium-lane wins: adaptive Settle, fewer round-trips, accuracy harness

## Goal

Make the Appium lane faster without changing connector semantics, and extend the benchmark so later Direct-lane work can prove a gate. Tickets [#185](https://github.com/Aris-ngoy/qa-agent/issues/185), [#186](https://github.com/Aris-ngoy/qa-agent/issues/186), [#182](https://github.com/Aris-ngoy/qa-agent/issues/182). Vocabulary: **Settle**, **Result screenshot**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- Settle polls immediately (~80 ms) and waits until the same frame holds for a 160 ms window. An animating screen still never settles. Tree stability stays off the default path.
- The connector Action no longer takes a dedicated “before” screenshot. `changed` compares the new Result to the previous Result fingerprint, so an out-of-band change still shows. Window size is remembered for the session.
- The latency report grows accuracy (tap vs tree) and Case pass rate rows. Suite v1 lives in [`benchmark-suite.json`](./benchmark-suite.json).

Rejected: baking tree stability into Settle (vision-first default), and translating Appium capabilities onto a Direct lane.

## What shipped

- `settleScreen`: `SETTLE_POLL_MS = 80`, `SETTLE_STABLE_WINDOW_MS = 160`, no lead-in.
- `performActionWithScreenshot`: `phases.captureMs` is 0; `actionMs` / `settleMs` are on the Action response and CLI output.
- Appium `getWindowSize` is cached for the session (`remember`).
- `yoqa benchmark` reads suite v1 (or `--suite path`), prints `tapAccuracy` / `casePassRate` when the driver returns hits or case results.

## How to verify

1. `bun test services/runner/src/domains/devices/action-result.test.ts services/runner/src/domains/devices/once.test.ts services/runner/src/domains/benchmark`
2. `yoqa action tap --x 500 --y 500 --screenshot` — `phases capture=0 action=… settle=…`; first Action has `changed unknown` until a second Action has a prior fingerprint.
3. `yoqa benchmark --device <id> --platform ios` — table includes latency rows; accuracy appears after taps against a live tree.

## Follow-ups

- Hardware Appium baseline to replace the synthetic [`benchmark-baseline.json`](./benchmark-baseline.json) (needed to claim a measured tap-to-result win on device).
- Case pass-rate needs suite `cases` plus a live catalog App; v1 ships `cases: []`.
- Android Direct lane [#189](https://github.com/Aris-ngoy/qa-agent/issues/189): see [android-direct-lane.md](./android-direct-lane.md). idb spike [#188](https://github.com/Aris-ngoy/qa-agent/issues/188) still needs a simulator.
