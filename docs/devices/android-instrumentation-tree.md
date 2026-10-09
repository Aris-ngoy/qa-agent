# Android: tree from the instrumentation helper (`device-android`)

## Goal

Ticket [#238](https://github.com/Aris-ngoy/qa-agent/issues/238) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-android`](../plans/device-lanes/device-android.md) second slice). On the Android Direct lane, read the Screen from a resident test-only APK (`yoqa.android.devtools`) instead of `uiautomator dump`, in under 150 ms. `uiautomator dump` stays as the fallback, with a warning. The port forward must not outlive the session.

## Plan summary

- **Part of `device-android`, not a new Lane or implementation.** The `device-android` Direct implementation (opt-in, `YOQA_DIRECT_ANDROID=device-android`) now starts the helper at connect. The Lane's `pageSource` converts the helper's tree into a `uiautomator dump` with pixel bounds, so the Screen cleaner, alert buttons and locators read it exactly as they read a dump. The 0.0–1.0 → pixel conversion happens once, at the Lane's edge (#233).
- **Served over the forward, not on stdout.** The plan said "JSON on stdout". One `am instrument` per read costs about 2–3 s on the emulator, so the helper instead runs for the whole session and answers `GET /tree` and `GET /status` on the device's loopback (port 7421). The runner reaches it through one `adb forward tcp:0 tcp:7421` per serial.
- **Fallback.** If the helper can't start (not installed and no APK built, install fails, or it doesn't answer within 10 s), the session reads with `uiautomator dump` and its Lane warning says why. If a tree read fails mid-session, the helper is stopped first, because it holds the device's UiAutomation and `uiautomator dump` would fail beside it. The session then uses `uiautomator dump` until it ends, and the warning is added to its Lane warning.
- **A helper a crashed runner left behind.** Every Android Direct session that doesn't start the helper force-stops `yoqa.android.devtools` at connect, and starting the helper force-stops any earlier one. Otherwise a leftover would keep UiAutomation and break `uiautomator dump`.
- **Rotation.** The helper reports the display's current size with the tree. The Lane converts bounds with that size (not `wm size`, which doesn't rotate), so the pixels match a dump in landscape too.
- **Install.** The runner checks `pm list packages --show-versioncode`. It installs with `adb install -r -t` when the package is missing or has another `versionCode`. When another version is installed and no APK is built, the helper doesn't start (fallback, with a warning).
- **Kotlin, no AndroidX.** The helper uses only platform APIs (`Instrumentation.getUiAutomation`, `AccessibilityNodeInfo`), so the APK carries no test libraries. Its tree matches `uiautomator dump`: nodes visible to the user, depth first, bounds clipped to the display, views not marked important included, resource ids reported.
- Rejected: per-read `am instrument` (too slow); a JSON-native Screen path in the cleaner (alerts and locators read dump attributes, so a dump-shaped tree reuses all of it).

## What shipped

- `native/android-devtools/`: Gradle project (AGP 8.13, Kotlin 2.2, Gradle wrapper 8.14.3).
  - `Wire.kt`: tree JSON encoding and the one-request HTTP handler (`/status` with `versionCode`, `/tree`, 404, 500 with the reason). An unreadable window is `{"nodes":[],"degraded":true}`. A readable window also carries `display` (pixels).
  - `WindowReader.kt`: reads the active window like `uiautomator dump`.
  - `DevtoolsInstrumentation.kt`: serves on `127.0.0.1:<port>` until force-stopped.
  - `WireTest.kt`: JVM tests of the wire protocol.
- `services/runner/src/domains/devices/`
  - `android-devtools.ts`: `startAndroidDevtools` (install, stale-forward cleanup, forward, `am instrument`, readiness wait, `stop`), `devtoolsTreeToDump`, `resolveDevtoolsApk` (`YOQA_ANDROID_DEVTOOLS_APK`, else the repo's build output).
  - `android-direct-lane.ts`: `AndroidDirectDeps.devtools`. Quit stops the helper.
  - `direct-lane.ts`: `device-android` starts the helper. A fallback between Direct implementations now keeps the session's own Lane warning instead of overwriting it.
  - Tests: `android-devtools-tree.test.ts` (Lane seam, helper faked), `android-devtools.test.ts` (tool seam: faked adb with a real forward table, and a local HTTP server standing in for the helper), a fifth Lane contract harness (`device-android` with the helper, with `uiautomator dump` failing so the tree must come from the helper), and a `session-registry` case for the warning merge.

## Measurements

Pixel_8 AVD (API 36, 1080×2400), Apple silicon, `pageSource` timed in-process against the real emulator: 20 helper reads after 3 warm-up reads, and 10 dump reads.

| Screen | helper p50 (max) | `uiautomator dump` p50 | Screens equal |
| --- | --- | --- | --- |
| Launcher (27 elements) | 46 ms (67) | 2686 ms | yes |
| Settings (59 elements) | 31–88 ms (96–130) | 2528–2753 ms | yes |
| Settings, landscape (29 elements) | 4 ms (4) | 2085 ms | yes |

- Under the 150 ms target on every screen. Each Screen, cleaned to 0–1000, is identical to the dump's.
- Starting the helper adds about 2.6–3.1 s to connect (`am instrument` start-up, plus the install on first use).
- `adb forward --list` is empty after quit.

**Promotion.** The tree gain is large and repeatable. `device-android` stays opt-in for two reasons. Its frame loop (#237) has not cleared its own gate. And the release runner doesn't ship the APK yet, so a release session would always fall back with a warning.

## How to verify

1. `bun test services/runner/src/domains/devices/{android-devtools,android-devtools-tree,lane-contract,session-registry}.test.ts`
2. `cd native/android-devtools && ANDROID_HOME=~/Library/Android/sdk ./gradlew testDebugUnitTest assembleDebug`
3. Live: build the APK (step 2), boot an emulator, then start the runner with `YOQA_DIRECT_ANDROID=device-android`. Connect on the Direct lane and read the Screen (tree mode). The first connect installs `yoqa.android.devtools`. Afterwards, `adb forward --list` shows one forward while connected and none after disconnect.

## Follow-ups

- Ship the APK with the runner (build it in release CI and embed or download it), so the helper works outside a repo checkout.
- Split the helper from the frame loop (or promote `device-android`) once both have cleared the gate. The helper alone has.
- Measure on a physical Android phone, and through the benchmark harness. It runs whole agent scenarios and has no tree-latency probe yet, so these numbers come from timing `pageSource` against the live emulator.
- IME and overlay windows: like `uiautomator dump`'s default, the helper reads only the active window.
- The helper could also serve frames, as a faster capture source for #237.
