# Spec: Device Control without Appium

Status: draft. Being refined by the wayfinder map [In-house device tools: beat Argent](https://github.com/Aris-ngoy/qa-agent/issues/213); the map's closing ticket folds its decisions in here. Supersedes [ADR-0004](../adr/0004-device-session-lanes.md) once accepted.

## Problem Statement

Yoqa drives devices mostly through Appium (WebDriverAgent on iOS, UiAutomator2 on Android). Every Action pays the HTTP and WDA hop, and the latency floor shows up in every connector loop and every Run step. Users also need to manage an Appium Runtime: install it, keep the drivers current, rebuild WDA, and diagnose a server that won't start. On top of that sits a confusing two-Lane model, where whether a session is "Direct" or "Appium" depends on device kind, installed binaries, and whether a Case set a custom capability.

Coding agents compare Yoqa to Argent, which talks to the platform directly and feels faster. Argent's fast path (its simulator-server, AX daemon, and injected dylibs) is private and can't be reused. Yoqa today has no device layer of its own that matches Argent's shape, and its benchmark has never measured Argent live.

## Solution

Replace Appium entirely with a host-side **tool server** inside the runner. It drives iOS simulators, physical iPhones, and Android devices and emulators through one tool API, built only from public tooling: `simctl`, `devicectl`, XCUITest, usbmux, and `adb`. The shape follows Argent's:

- **iOS simulator:** a persistent per-device sim server for frames and HID, plus our own accessibility reader spawned into the simulator, with `simctl` as the control plane.
- **Physical iPhone:** a signed XCUITest runner, built from source on the user's Mac, reached over usbmux. `devicectl` handles discovery and app lifecycle.
- **Android:** `adb` for control and input, plus a test-only instrumentation APK for the accessibility tree. `uiautomator dump` is the fallback.

The same tools are reachable two ways over one registry: the `yoqa` CLI (existing users, CI, the `yoqa-testing` skill) and an MCP server (coding agents).

Success is measured: p50 tap-to-result and screen-read at or below Argent's on the same device, for an iOS simulator, an Android emulator, and a physical iPhone.

**Appium is removed completely.** When this plan is done, Yoqa has no Appium code, no WebDriverIO dependency, no Appium Runtime to install or manage, no WDA builds, no `appium:` capabilities, no Lanes, and no Appium in the docs, skill, CLI, desktop, CI, or glossary. There is no Appium fallback and no opt-in Appium mode. Each device kind's Appium path is deleted in the same milestone that ships its replacement, so Appium shrinks milestone by milestone and is gone after the last one.

## User Stories

1. As a coding agent, I want to call `list-devices` and get every simulator, emulator, and cabled device in one list within a short timeout, so that I can pick a target without waiting on a slow backend.
2. As a coding agent, I want each device record to carry `id`, `platform`, `kind`, `state`, and `capabilities`, so that I know which tools will work before I call them.
3. As a coding agent, I want a tool that needs a missing capability to fail with that capability's name, so that I know exactly why and never get silent fallback to a different backend.
4. As a coding agent, I want `describe` to return role, label, value, identifier, frame, and enabled for every element, so that I can ground taps on a simulator, an emulator, or a phone in the same way.
5. As a coding agent, I want `describe` to return quickly with an explicit "empty tree" result when the simulator's AX server returns nothing, so that I can fall back to screenshot coordinates instead of hanging.
6. As a coding agent, I want `tap`, `swipe`, and `type` in the existing relative 0–1000 space on every device kind, so that grounding, Grid mode, and the Run report keep one coordinate space.
7. As a coding agent, I want `screenshot` to return a PNG on every device kind, so that Vision mode works everywhere.
8. As a coding agent, I want every mutating call to carry a `commandId`, so that a retried call after a lost reply returns the original result instead of tapping twice.
9. As a coding agent, I want to query a `commandId`'s status, so that I can resolve a lost reply without resending the gesture.
10. As a coding agent, I want `button` to declare which hardware buttons each device supports and reject the rest by name, so that I don't press something the device can't press.
11. As a coding agent, I want `launch-app`, `restart-app`, and `reinstall-app` to take a bundle id or package name, so that app lifecycle is the same call on every platform.
12. As a coding agent, I want `open-url` on every device kind, so that deep links work the same way everywhere.
13. As a coding agent, I want `boot-device` for simulators and emulators, and a clear rejection for physical devices, so that I can start a target without leaving the tool API.
14. As a coding agent, I want `stop-session` to free ports, usbmux forwards, and child processes, so that a finished session leaves nothing running.
15. As a coding agent using MCP, I want the same tools under the same names as the CLI, so that a skill written for one works with the other.
16. As a CLI user, I want `yoqa screen`, `yoqa action`, and `yoqa screenshot` to keep working with no Appium installed, so that my scripts and CI don't change.
17. As a CI user, I want a headless `yoqa serve` that needs no Appium Runtime, so that runners start faster and have fewer moving parts.
18. As an iOS simulator user, I want Actions to go through a persistent sim server rather than spawning a process per call, so that tap-to-result is faster than Argent's.
19. As an iOS simulator user, I want the Inspector live view to stream frames from the sim server, so that I keep the live view I had with Appium MJPEG.
20. As an iOS simulator user, I want Run recording to keep working, so that opt-in per-Case video is unchanged.
21. As an iOS simulator user, I want the tool server to find SimulatorKit and the device UI through `xcode-select -p` (Simulator.app or Device Hub), so that new Xcode versions don't break it.
22. As an iOS simulator user, I want `simctl` to handle boot, install, launch, terminate, `openurl`, and privacy, so that lifecycle uses Apple's public control plane.
23. As a physical iPhone user, I want Yoqa to build and sign the XCUITest runner on my Mac with my Apple Development identity, so that I need no Appium and no paid account (a free Personal Team works).
24. As a physical iPhone user, I want the newest Apple Development identity in my keychain picked automatically, with an env var to override the team id, so that signing works without configuration.
25. As a physical iPhone user, I want the built runner cached by source hash, Xcode version, and team, so that only the first connect pays for a build.
26. As a physical iPhone user on a Personal Team, I want an expired signature (about 7 days) to trigger a rebuild on the next call, so that I don't have to diagnose it myself.
27. As a physical iPhone user, I want a locked phone, Developer Mode being off, or a pending developer-profile trust prompt to fail before any build starts, with the exact fix named, so that I don't wait on a doomed build.
28. As a physical iPhone user, I want control only over USB, with a Wi-Fi-only (`paired`) phone listed but rejected as a target, so that it's clear why a phone can't be driven.
29. As a physical iPhone user, I want a stuck main thread in the runner to return `RUNNER_WEDGED` rather than hang, so that the agent can restart the session.
30. As a physical iPhone user, I want to be told when a gesture brought the app back to the foreground, so that I know the screen changed for a reason other than my tap.
31. As a physical iPhone user, I want the Inspector to poll screenshots while there's no live stream, so that it still works.
32. As an Android user, I want the tree read through the instrumentation APK (installed with `adb install -r -t`), so that `describe` is faster and richer than `uiautomator dump`.
33. As an Android user, I want `uiautomator dump` used automatically when the APK can't be installed or run, with the result saying which source was used, so that I still get a tree.
34. As an Android user, I want system dialogs (permission sheets, ANR) in the tree, so that agents can handle them as they do today.
35. As an App owner who set `appium:autoLaunch`, `appium:appActivity`, or `appium:appWaitActivity`, I want those values migrated to first-class App or Case settings, so that my Cases keep behaving the same.
36. As an App owner with an Appium capability Yoqa can't translate, I want the migration to fail loudly and name it, so that nothing is silently ignored.
37. As a desktop user, I want the configuration page to show first-class launch settings instead of a free-form Appium capability list, so that I can see what each setting does.
38. As a desktop user, I want the servers panel and `yoqa doctor` to check Xcode, `xcode-select`, the signing identity, `adb`, the sim server, and the runner build, instead of the Appium Runtime, so that diagnostics match what actually runs.
39. As a Yoqa maintainer, I want `yoqa benchmark --tools yoqa,argent` to drive a real Argent adapter, so that "faster than Argent" is measured rather than asserted.
40. As a Yoqa maintainer, I want each backend's milestone to merge only after the benchmark shows it at or below Argent's p50 on its device kind, so that speed claims hold.
41. As a Yoqa maintainer, I want each device kind's Appium path deleted in the same milestone that ships its replacement, so that no device kind is ever without a working path and no Appium path outlives its replacement.
42. As a Yoqa maintainer, I want one parity checklist per device kind (connect, `describe`, tap, swipe, type, lifecycle, `open-url`, screenshot, alerts, live view, recording), so that "parity" is not a judgement call.
43. As a Run, I want the Active Session to keep working the same way (adopt, view-only, stay live), so that ADR-0001 is unchanged.
44. As a Run report reader, I want the report to name the backend and the device capabilities in use instead of a Lane, so that I know what drove the run.
45. As a skill author, I want the `yoqa-testing` skill and the public docs to stop mentioning Appium once removal ships, so that agents aren't told to manage a runtime that's gone.
46. As a security-minded user, I want the sim server and the phone runner bound to loopback only (the runner reachable only over the cable), so that device control isn't exposed to the network.
47. As a Yoqa maintainer, I want a repo-wide check that no Appium, WebDriverIO, WDA, or Lane reference remains outside historical ADRs and changelogs, so that "removed completely" can be verified.
48. As an existing user upgrading, I want the first launch after the removal release to migrate my catalog and tell me what changed, and to stop or uninstall any Appium server Yoqa started before, so that nothing stale is left running or on disk.
49. As a CI user, I want the GitHub Actions setup to stop installing Appium and drivers, so that CI jobs are shorter.

## Implementation Decisions

**Architecture**

- The tool server lives inside the runner process. It replaces the `devices` and `ios` domains and the `appium` domain is deleted, so Runs, the Active Session, and the desktop keep one host process. Native pieces ship as separate packages: `ios-sim-server`, `ios-ax-service`, `ios-device-runner` (an Xcode project with a host app and an XCUITest bundle), and `android-devtools` (the instrumentation APK).
- **One tool registry, two front doors.** Every tool is defined once (name, input schema, required capabilities, handler). The CLI (through the runner HTTP API and `runner-client`) and a new MCP server both expose it. Tool names follow the Tool API below. Existing CLI verbs map onto them and keep working.
- **`DeviceSession` stays the seam.** Each device kind has exactly one backend. `lane`, `laneWarning`, `LaneName`, `LaneFactory` selection, `--lane`, and the Appium fallback are removed. The session exposes its device's `capabilities` instead. Exclusivity per device id and the Active Session are unchanged (ADR-0001).
- A new ADR supersedes ADR-0004: Appium is removed, there are no Lanes, the device capability model replaces them, and the Argent benchmark is the merge gate.

**Native languages**

- **Swift** for all three iOS packages: `ios-sim-server`, `ios-ax-service`, and `ios-device-runner`. A thin C header is allowed only for the packed structs that private SimulatorKit/Indigo HID calls need. Encoding and scaling use VideoToolbox and vImage from Swift.
- **Kotlin** for `android-devtools`. UiAutomation and input injection are Java APIs, so neither Swift nor C++ applies on Android.
- **TypeScript (Bun)** stays the host tool server: registry, sessions, usbmux, and the command journal. That work is I/O orchestration, not CPU-bound.
- **No C++.** It goes in only if a profiler shows a CPU-bound hot path (for example frame diffing) that Swift with Accelerate or Metal can't meet.
- Speed comes from architecture, not language: persistent per-device processes (no spawn per Action), one long-lived socket per device, screenshots taken from the latest frame instead of encoded fresh each time, and bounded AX reads.

**Device model**

- One record per device: `id` (simulator UDID, device UDID, or adb serial), `platform` (`ios` | `android`), `kind` (`simulator` | `emulator` | `device`), `state` (`booted` | `shutdown` | `connected` | `paired`), `capabilities` (tokens).
- Capability tokens: `simctl`, `simulator-server`, `ax-service`, `native-devtools` (later, simulator only), `xcuitest-runner`, `adb`, `android-devtools`.
- A tool that lacks a required token fails with an error naming the token, and never falls through to another backend.
- `paired` on iOS means Wi-Fi only. It is listed but is not a target.
- `list-devices` runs discovery per backend in parallel, each with a short timeout. A slow backend drops out of the result with a warning instead of blocking the call.

**Tool API** (stable from milestone 1; backends fill in capabilities, and the schema never forks per platform)

- `list-devices`, `boot-device` (simulators and emulators only), `launch-app`, `restart-app`, `reinstall-app`, `open-url`, `describe`, `screenshot` (PNG), `tap`, `swipe`, `type`, `button`, `stop-session`.
- Coordinates are relative 0–1000, matching the existing Screen and grounding space.
- Mutating calls carry a `commandId`. The session seam keeps a bounded journal per session: a repeated `commandId` returns the recorded result without re-executing. A status call resolves a lost reply. The phone runner keeps its own journal as well, for usbmux reconnects.
- `button` returns the supported set per device and rejects the rest by name.

**iOS simulator backend**

- `simctl` is the control plane: boot, install, launch, terminate, `openurl`, privacy, and `io screenshot` as a fallback.
- Frameworks and the device UI app are resolved from `xcode-select -p` at runtime, covering both Simulator.app and Device Hub. Nothing is hardcoded.
- The sim server is a persistent per-device process, bound to 127.0.0.1, that provides HID input and a frame stream (MJPEG or equivalent) for the Inspector live view, screenshots, and Run recording. In Argent's shape this is required, not optional: speed comes from avoiding a process spawn per Action.
- The AX service is a small binary launched with `simctl spawn`. It reads the simulator AX server and returns role, label, value, identifier, frame, and enabled over one Unix socket per UDID on the host. An empty tree is reported as such, with a bounded wait. It never sets the old `AutomationEnabled` preference.
- idb_companion is retired once the sim server and AX service pass parity and the gate.

**Physical iPhone backend**

- The runner is a tiny host app plus an XCUITest target. Its test method starts a loopback HTTP/1.1 server (no auth) and waits. Session, gestures, snapshot, screenshot, and text entry each live in their own file. A main-thread gate returns `RUNNER_WEDGED`, and a command journal dedupes retried POSTs.
- Host side: `devicectl` handles discovery and lifecycle. usbmuxd forwarding goes `ListDevices` (UDID to DeviceID), then `Connect` (runner port), then HTTP over that socket.
- Signing: the newest Apple Development identity in the keychain is used, with a team-id env var override. The build is `xcodebuild build-for-testing` with automatic signing and `-allowProvisioningUpdates`. The bundle id is derived from the team id. The product is cached by source hash, Xcode version, and team.
- Preflight runs before any build: USB connection, unlocked, Developer Mode on, no pending trust prompt. Each failure names its fix.
- No live stream and no recording in the first release. The Inspector polls screenshots.

**Android backend**

- `adb` handles control (`input`, `exec-out screencap -p`, `pm install`, `am start`, `am force-stop`), building on the existing Android Direct lane.
- `describe` goes through the instrumentation APK (`adb install -r -t`, `am instrument`). `uiautomator dump` is the fallback, and the result records which source was used.
- Live view and recording keep their current adb-based behaviour.

**Complete Appium removal**

Removal is a deliverable of this plan, not a follow-up. The end state has zero Appium. The inventory below is what gets deleted or replaced.

- **Runner:** the `appium` domain (server lifecycle, runtime install and management, foreign-server detection) is deleted. Its non-Appium helpers (Android SDK resolution, host path lookup) move to the backends that use them. The Appium lane, the WDA reuse/rebuild logic, the Appium recording path, the MJPEG broadcaster settings, the Lane selection and fallback, and the Appium-shaped dead-session detection are deleted. The idb_companion backend is deleted too once the sim server replaces it.
- **Dependencies:** `webdriverio` and every Appium driver are removed from the runner. No package depends on Appium, and package descriptions and keywords drop it.
- **Runner client schemas and HTTP API:** the Lane name, Appium driver, Appium version and source, WDA install, bundle id and action, and `stop-foreign-appium` fields and routes are removed. Device records carry `kind`, `state`, and `capabilities` instead. This is a breaking API change, versioned with the CLI.
- **Catalog:** App and Case Appium capabilities are replaced by first-class launch settings. The minimum set is `autoLaunch`, `launchActivity` (from `appActivity`), and `waitActivity` (from `appWaitActivity`, wildcards kept). A research step lists every capability actually documented or stored before the set is final. A one-time migration converts the known capabilities and fails loudly, naming any unknown ones. Nothing is dropped silently. The capability columns and fields are then dropped.
- **CLI:** `--lane`, WDA rebuild/skip, Appium server commands, and Appium wording in help and output are removed. `yoqa doctor` checks Xcode, `xcode-select`, the signing identity, `adb`, the sim server, the runner build, and the Android devtools APK.
- **Desktop:** the configuration page swaps the capability list for launch settings. The Inspector drops its Appium session wiring. The servers panel and doctor show the tool server and backends. The Runs panel's WDA Skip/Rebuild goes. The Android toolchain feature drops its Appium checks.
- **Upgrade cleanup:** on first launch after the removal release, Yoqa stops any Appium server it started and deletes the managed Appium Runtime and WDA caches under its home directory. Nothing outside Yoqa's home is touched.
- **CI and release:** the `setup-yoqa` action, the Expo demo e2e workflow, and the macOS release workflow stop installing Appium and drivers. The Expo smoke runs on the new backends.
- **Benchmark:** the Appium arm is removed. The comparison is Yoqa vs Argent only.
- **Docs and skill:** the Appium capabilities guide is replaced by a launch-settings guide. Every public doc page, the `yoqa-testing` skill and its references, `ARCHITECTURE.md`, and the `docs/devices` lane notes are rewritten or marked superseded.
- **Glossary and ADRs:** `CONTEXT.md` retires **Lane**, **Appium Runtime**, and **Appium Server**, and adds **Tool server**, **Backend**, and **Device capability**. The Run report names the backend and capabilities instead of a Lane. A new ADR supersedes ADR-0004. ADR-0001 is amended where it mentions Appium.
- **Definition of done:** a repo-wide search for `appium`, `webdriverio`, `wda`, and `lane` (as the session concept) finds matches only in superseded ADRs, changelogs, and this spec's history.

**Milestones** (each ends with its parity checklist plus the benchmark gate where it applies)

0. Real Argent adapter in `yoqa benchmark`. Baseline Argent on an iOS simulator, an Android emulator, and a physical iPhone.
1. Tool registry, device model, `list-devices`, `simctl` and `adb` lifecycle, PNG screenshot. CLI and MCP front doors. Capability migration to first-class launch settings, because every later deletion depends on it.
2. Android instrumentation snapshot plus input: the first closed loop with no Appium. Gate on the emulator and a device. **Delete the Android Appium path** (UiAutomator2, Android capability handling, and the Android Lane selection).
3. Simulator AX service and sim server (HID and frames), so `describe` matches the phone. Gate on the simulator. **Delete the iOS-simulator Appium path and idb_companion.**
4. Physical iPhone runner: snapshot, tap, type, usbmux, keychain signing. Gate on the phone. **Delete the last Appium path** (WDA build and reuse, the Appium server and runtime, and `webdriverio`).
5. Sweep: schemas, CLI, desktop, CI, docs, skill, glossary, ADR, and upgrade cleanup, until the definition of done holds.
6. Later: injected devtools (simulator only, skipping `com.apple.*`).

The simulator comes before the physical iPhone because it is the larger speed gap against Argent. The physical-iPhone runner is the critical path for deleting Appium, so its work can start in parallel once milestone 1 lands.

## Testing Decisions

- A good test drives the public seam and asserts observable results (the tool response, the recorded command, the error naming a missing capability). It never asserts which internal helper ran.
- **Seam 1, the tool registry:** tools are invoked through the registry with a fake `DeviceSession`. This covers schema validation, capability gating (missing token gives a named error), `commandId` dedupe and status, the 0–1000 coordinate contract, and CLI/MCP parity (same tool, same result).
- **Seam 2, `DeviceSession` per backend:** one shared contract suite runs against every backend, each with a fake transport (fake `adb`, fake `simctl`/`devicectl`, a fake sim-server socket, a fake runner HTTP server over a fake usbmux). Prior art: `android-direct-lane.test.ts`, `ios-direct-lane.test.ts`, and `idb-companion.test.ts`, which inject fake binaries so CI needs no device.
- The phone runner's HTTP protocol is tested from the host side against the fake runner. On-device behaviour is verified by the hardware parity checklist, not by CI.
- The capability migration is tested on catalog fixtures: known capabilities convert, unknown ones fail with their names.
- The benchmark (`yoqa benchmark --tools yoqa,argent`) is the speed gate. It runs on real devices and is not a CI check. Prior art: the `benchmark/` domain tests with fake drivers.

## Out of Scope

- Wi-Fi control of iPhones.
- iPad.
- Copying Argent's (or any other project's) simulator server, AX service, or dylibs. Only the architecture is reused.
- On physical iPhones: pinch, rotate, paste, shake, screen recording, live MJPEG view, and dylib injection.
- JS debugging, Instruments, Perfetto, and profilers until the interaction loop is solid (see the existing diagnostics issue).
- Any Appium lane, fallback, compatibility mode, or opt-in, at any point after its device kind's replacement ships.
- Passing arbitrary `appium:` capabilities through. Only the migrated launch settings exist.

## Further Notes

- Decisions come from the grilling session. The user's direction: remove Appium entirely, follow an Argent-like architecture, and be faster than Argent. The round-3 recommendations below were taken as accepted when the user moved straight to this spec. Confirm or correct them:
  - Agent surface is both MCP and CLI, over one shared tool registry.
  - The tool server lives in the runner, not in a new top-level package.
  - Appium is removed completely. Each device kind's Appium path is deleted in the milestone that ships its replacement, and a final sweep leaves zero references.
  - Appium capabilities are promoted to first-class App/Case settings, with loud migration of unknown ones.
  - Coordinates stay relative 0–1000, and every backend dedupes on `commandId`.
  - Physical iPhones ship without live view or recording in the first release.
- Native languages decided: Swift for iOS, Kotlin for Android, TypeScript on the host, no C++ unless profiling demands it.
- Open: the Android backend sends input through `adb shell input`, which starts a JVM on every call (about 200–400 ms). Moving input into a persistent on-device server (the instrumentation process or an `app_process` server) is probably needed to beat Argent on Android.
- The idb spike measured idb about 8× faster than WDA on taps. The Argent comparison has never run, so milestone 0 comes first.
- The highest-risk pieces are the simulator AX reader (empty trees on new iOS versions) and HID through private SimulatorKit APIs. Both are resolved at runtime from the active Xcode and are the first things a new Xcode release will break.
