# iOS Direct lane over idb_companion

## Goal

Run connect, tap, swipe, drag, type, app lifecycle, open URL, and screenshot on an **iOS simulator** without the Appium server. Ticket [#198](https://github.com/Aris-ngoy/qa-agent/issues/198). Selection rules: [ADR-0004](../adr/0004-device-session-lanes.md). Spike: [idb-companion-spike.md](./idb-companion-spike.md).

## Plan summary

- The Direct factory is registered for iOS. Auto-pick and `--lane direct` use it on simulators; custom capabilities still pin Appium. Physical UDIDs (`00008120-…` shape) throw so connect falls back once (existing dispatcher).
- Gestures and screenshots go through the official `idb` client (`ui tap --api hid`, `ui swipe`, `ui text`, `screenshot`, `launch` / `terminate` / `open`). Tree reads are `ui describe-all --api axbridge --format complete`; Screen mapping is [ios-direct-tree-settle.md](./ios-direct-tree-settle.md). No MJPEG (`stream: null`).
- Companion comes from `YOQA_IDB_COMPANION`, `~/.yoqa/idb/idb_companion`, or `PATH` — the GitHub `facebook/idb` v1.6.5 macOS binary. Homebrew `facebook/fb` tap trust is not required.
- Rejected: translating Appium capabilities onto idb, switching Lane mid-session, and driving physical iOS through companion.

## What shipped

- `createIosDirectSession` in `services/runner/src/domains/devices/ios-direct-lane.ts`
- `defaultLanesFor("ios")` includes Direct
- `requireIdbBins` install hint names the GitHub release, not `brew trust`
- Tests inject a fake `idb` so CI does not need a simulator
- Expo iOS smoke pins `--lane appium` so the job still exercises WDA

## How to verify

1. `bun test services/runner/src/domains/devices/ios-direct-lane.test.ts services/runner/src/domains/devices/idb-companion.test.ts services/runner/src/domains/devices/session-registry.test.ts`
2. Place `idb_companion` from the `v1.6.5` GitHub release at `~/.yoqa/idb/idb_companion` and `fb-idb` at `~/.yoqa/idb/venv/bin/idb` (or set `YOQA_IDB_COMPANION` / `YOQA_IDB`).
3. Boot a simulator. `yoqa devices connect <udid> --platform ios` — connect JSON `lane` is `direct` when the App/Case has no custom capabilities.
4. `yoqa action tap --x 500 --y 500 --screenshot`. The Run report names the Direct lane.
5. `yoqa devices connect … --lane appium` still uses Appium; physical iOS and custom capabilities stay Appium.

## Follow-ups

- [#199](https://github.com/Aris-ngoy/qa-agent/issues/199): see [ios-direct-tree-settle.md](./ios-direct-tree-settle.md).
- Hardware Case on a simulator to tick the “sample Case end to end” box in #198.

## Later changes

- Since [#245](https://github.com/Aris-ngoy/qa-agent/issues/245) this is the fallback implementation (`idb`) behind `device-sim`. Its taps, swipes and pointer events in `screenshot` coordinate space used to be sent in screenshot pixels, 3× off, and now go in points: [ios-sim-promotion.md](./ios-sim-promotion.md).
