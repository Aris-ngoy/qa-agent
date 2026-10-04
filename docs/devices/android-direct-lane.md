# Android Direct lane over adb

## Goal

Run a Case with no custom Appium capabilities on an Android emulator or device without the Appium server: connect, tap, swipe, drag, type, app lifecycle, open URL, screenshot. Ticket [#189](https://github.com/Aris-ngoy/qa-agent/issues/189). Selection rules: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- The Direct factory is registered only for Android. Auto-pick and `--lane direct` use it; custom capabilities still pin Appium. A failed adb connect falls back once (existing dispatcher).
- Gestures and screenshots go through `adb` (`input tap` / `swipe`, `screencap`, `wm size`). App launch uses `monkey`; stop uses `am force-stop`. Tree reads dump to `/sdcard/yoqa-window.xml` (system-wide, including dialogs). No MJPEG (`stream: null`).
- Rejected: translating Appium capabilities onto adb, and switching Lane mid-session.

## What shipped

- `createAndroidDirectSession` in `services/runner/src/domains/devices/android-direct-lane.ts`
- `defaultLanesFor("android")` includes Direct; iOS stays Appium-only
- Tests inject a fake `adb` so CI does not need an emulator

## How to verify

1. `bun test services/runner/src/domains/devices/android-direct-lane.test.ts services/runner/src/domains/devices/adb-input.test.ts services/runner/src/domains/devices/session-registry.test.ts`
2. Boot an emulator. `yoqa devices connect <avd-or-serial> --platform android` — connect JSON `lane` is `direct` when the App/Case has no custom capabilities.
3. `yoqa action tap --x 500 --y 500 --screenshot` and a Case without capabilities. The Run report names the Direct lane.
4. `yoqa devices connect … --lane appium` still uses Appium; Android Appium behaviour is unchanged.

## Follow-ups

- [#190](https://github.com/Aris-ngoy/qa-agent/issues/190): see [android-direct-tree-settle.md](./android-direct-tree-settle.md).
- Hardware Case on an emulator to tick the “sample Case end to end” box in #189.
