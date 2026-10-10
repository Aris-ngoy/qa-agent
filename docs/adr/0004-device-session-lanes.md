---
status: accepted
---

# A Device Session runs on one Lane: Appium or Direct

Every Action goes through Appium (WebDriverAgent / UiAutomator2 over HTTP), which sets a latency floor that [Argent](https://github.com/software-mansion/argent) avoids on simulators and emulators by talking to the platform directly. We decided to keep Appium as a product pillar and add **Direct lanes** behind the Device Session seam, staged: no-regret Appium wins first, then an Android Direct lane (adb), then an iOS-simulator Direct lane only if a time-boxed idb_companion spike clears the benchmark gate. Argent's own fast path (its simulator-server, AX daemon and injected dylibs) lives in a private repo and is not copyable, so we copy the architecture, not the code.

- **One Lane for the whole session.** Never switch mid-session; a Run adopts the Active Session's Lane ([ADR-0001](./0001-device-session-ownership.md)).
- **Selection.** Direct is chosen automatically where supported, with an explicit override (`--lane appium|direct`). If the Direct lane fails to start at connect, fall back to Appium once, loudly (connect result and Run report). The report always names the Lane that ran.
- **Capabilities pin Appium.** A Case or App that sets custom Appium capabilities always gets the Appium lane. Capabilities keep their documented meaning and are never silently ignored or half-translated.
- **Gate.** A benchmark harness drives Argent and Yoqa through the same scenario on the same device (tap-to-result p50/p95, screen read, cold start, tap accuracy, case pass rate). Each stage must show a measured gain before merging; the finish line is Yoqa p50 tap-to-result at or below Argent's on both platforms.

## Considered options

- **Appium only**, optimized in place: lowest risk, but cannot reach Argent's latency because the HTTP/WDA hop is the floor.
- **Replace Appium everywhere** (including a physical-iOS XCUITest runner): largest rewrite, loses custom capabilities and the Appium ecosystem, for no gain on physical iOS where Argent also uses XCUITest.
- **Replace Appium everywhere** was rejected for physical iOS again once `device-ios` was measured ([ios-device-benchmark.md](../devices/ios-device-benchmark.md), 2026-10-10, iPhone 15, iOS 27.0.1): tap-to-result p50 2892 ms against Appium's 2639 ms, and no tree read inside 30 s on the home screen. The rejected option was replacing Appium, not adding a Lane; `device-ios` stays an explicit-`direct` Lane and `auto` keeps Appium on a phone.
- **Direct lane first on iOS simulators:** biggest gap, but no copyable implementation and unverified tooling (idb_companion) — hence the spike gate. The spike ([#188](https://github.com/Aris-ngoy/qa-agent/issues/188), [idb-companion-spike.md](../devices/idb-companion-spike.md)) recommends **adopt** on simulators: companion v1.6.5 beat Appium/WDA tap-to-result (~8×) and screen read (~25×) on the same iOS 26.5 sim. vs-Argent is still unmeasured (public Argent CLI is not a tap harness).
- **Translate a subset of Appium capabilities** into the Direct lane, or ignore them with a warning: rejected as silent behaviour drift.

## Consequences

- `DeviceSession` becomes an interface implemented per Lane; today's `browser` handle is only used inside `session.ts`, and `mjpegPort` is Appium-shaped and must move behind the Appium lane.
- Screen mode defaults are unchanged (vision-first, see `docs/runs/vision-first-screen-mode.md`). A faster system-wide tree makes Tree assist cheaper; "screenshot + tree every step" is a benchmark arm, not a default.
