# Connector speed: Lane selection, Agent image, Action batch

## Goal

Ship the three product tickets that do not wait on a hardware benchmark: name the Lane that ran ([#187](https://github.com/Aris-ngoy/qa-agent/issues/187)), hand connector callers an Agent image ([#183](https://github.com/Aris-ngoy/qa-agent/issues/183)), and batch known Actions ([#184](https://github.com/Aris-ngoy/qa-agent/issues/184)). Vocabulary: **Lane**, **Agent image**, **Result screenshot** in [`CONTEXT.md`](../../CONTEXT.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- Lane selection is a pure function. Custom Appium capabilities pin Appium. Android auto-picks Direct when that factory is registered; a failed Direct start or a forced Direct with no factory falls back once and says so. The session never switches Lane afterwards.
- The raw Result screenshot stays on disk. The caller gets a downscaled Agent image by default (`--full` / `--scale` override).
- A batch is coordinate / id / label only. Description-grounded steps are rejected up front. One Settle and one screenshot at the end.

## What shipped

- `yoqa devices connect … --lane appium|direct|auto`. Connect JSON, `yoqa devices active`, and the Run report name the Lane and any warning.
- `yoqa runs create … --lane …`
- `yoqa action … --screenshot` returns the Agent image path; `raw` is printed when a downscaled copy was made. `--full` and `--scale` override.
- `yoqa action batch [file]` (or stdin): `{ "steps": [ Action, … ] }`.

## How to verify

1. `yoqa devices connect <id> --platform ios --lane direct` — Direct when `idb_companion` is installed (see [ios-direct-lane.md](./ios-direct-lane.md)); otherwise Appium with `lane warning: Direct lane failed to start`.
2. `yoqa action tap --x 500 --y 500 --screenshot` — `screenshot` is the Agent image; on macOS a `raw` line appears when sips downscaled.
3. `printf '{"steps":[{"kind":"tap","x":100,"y":100},{"kind":"tap","x":200,"y":200}]}' | yoqa action batch --screenshot` — one screenshot after both taps.
4. A batch step with `"description":"…"` is rejected before anything runs.
5. `bun test services/runner/src/domains/devices packages/runner-client/src/run-report.test.ts`

## Follow-ups

- Android Direct lane ([#189](https://github.com/Aris-ngoy/qa-agent/issues/189)): `--lane auto` picks Direct on Android when there are no custom capabilities.
- Hardware baseline for [#181](https://github.com/Aris-ngoy/qa-agent/issues/181).
