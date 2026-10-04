# Android Direct: system-wide tree, adaptive Settle, benchmark gate

## Goal

The Direct lane’s Screen includes system dialogs, Settle runs on its own `screencap` frames, and the benchmark harness can prove the Android gate against Argent. Ticket [#190](https://github.com/Aris-ngoy/qa-agent/issues/190). Vocabulary: **Lane**, **Settle**, **Screen** in [`CONTEXT.md`](../../CONTEXT.md). Rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- `uiautomator dump` is system-wide (ANR / permission sheets), unlike Appium’s app-scoped page source. Parse `<node class="…">` so those dialogs show up as buttons and labels. Dump to a file and `cat` it — `/dev/tty` often never reaches adb stdout, which made `yoqa screen` return `elements: []`.
- Adaptive Settle already polls `captureFrame`. Direct’s frame source is `adb exec-out screencap -p`; no second Settle path.
- Rejected: inventing a vs-Argent p50 without a hardware run. The harness already takes `--lane direct`. The number is recorded when Argent is on `PATH` on the same emulator.

## What shipped

- `cleanPageSource` treats uiautomator `<node>` tags as their `class` (system dialogs stay in the Screen)
- Direct `pageSource` dumps to `/sdcard/yoqa-window.xml` and fails if the dump has no XML
- Expo Android smoke pins `--lane appium` so a Pixel Launcher ANR cannot hide “Yoqa Demo” (#147)
- Tests: ANR dump → Wait / Close app; Direct `settleScreen` on screencap; empty dump throws

## How to verify

1. `bun test services/runner/src/domains/devices/screen.test.ts services/runner/src/domains/devices/android-direct-lane.test.ts services/runner/src/domains/devices/interaction.test.ts`
2. On an emulator with an ANR or permission sheet: `yoqa devices connect … --lane direct` then `yoqa screen --json` — elements include the system buttons.
3. `yoqa action tap --x 500 --y 500 --screenshot` on Direct — `phases settle=…` from screencap polls.
4. Gate (needs Argent + the same Android device):

```bash
yoqa benchmark --device <id> --platform android --lane direct --tools yoqa,argent --out docs/devices/benchmark-android-direct.json
```

Yoqa p50 `tapToResult` must be ≤ Argent’s. Also run `--lane appium` and confirm `tapAccuracy` does not drop versus that Appium run on the same suite.

## Follow-ups

- Record `docs/devices/benchmark-android-direct.json` from a live Argent + emulator run (the vs-Argent AC). Until then the gate is unmeasured.
- No accuracy regression vs Appium is the same hardware check.
- [#191](https://github.com/Aris-ngoy/qa-agent/issues/191): screenshot + tree every step as a benchmark arm.
