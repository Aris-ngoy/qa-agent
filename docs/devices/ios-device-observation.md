# Physical iOS: snapshot, typing and errors

## Goal

Ticket [#250](https://github.com/Aris-ngoy/qa-agent/issues/250) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ios`](../plans/device-lanes/device-ios.md), fifth slice). The physical-iOS Direct lane reads the Screen tree, types, and presses a hardware button through `YoqaRunner`. A snapshot of a backgrounded app is `APP_BACKGROUNDED` and does not steal focus. A stuck main thread is `RUNNER_WEDGED`. Both reach the caller as clear errors.

Builds on [ios-device-actions.md](./ios-device-actions.md) (gestures, the journal, the link).

## Plan summary

- **`snapshot` returns `yoqa-ax`'s node shape.** `{ nodes: [{ role, label?, value?, id?, frame (0.0–1.0 of the screen), enabled }] }`. The Lane feeds it to `yoqaAxTreeToSource`, so the Screen, the cleaner and the locators read a phone's tree as they read the simulator's. An empty read is marked degraded, as on the simulator.
- **Which app.** `bundleId` on the request names the app; the Lane sends the session's bundle id, then the last one `activateApp` launched. Without one the runner reads SpringBoard. The runner checks `XCUIApplication.state == .runningForeground` and never calls `activate()`, so observation can't change the foreground. A background app is `APP_BACKGROUNDED` (409).
- **`MainThreadGate`.** XCUITest must run on the main thread. `MainThreadGate.run` hands work to the main queue and waits 8 s; if the main thread never gets to it the gate throws `RunnerWedged` and the Session answers `RUNNER_WEDGED` (503). `PhoneDevice` routes every XCUITest call through the gate. The gate is in the core package, so a stuck queue is tested on the host.
- **Input commands.** `type { text }`, `keyboardReturn`, `keyboardDelete` and `button { name: home | volumeUp | volumeDown }` are journaled like gestures. Typing goes through `springboard.typeText`, which sends keys to whatever has keyboard focus.
- **Lane mapping.** `type(text)` cuts the text at a newline (return) and at a backspace character `\b` (delete); the rest is typed as is. `backgroundApp(seconds)` presses home, waits, and relaunches the app with `devicectl`.
- **Errors.** `APP_BACKGROUNDED` and `RUNNER_WEDGED` stay `YoqaRunnerCommandError`s with their code, with a plain message that names the app or tells the user to open a new session. They are not Dead Sessions: the runner answered.
- **Contract suite.** The `device-ios` harness answers `snapshot`, so the tree test runs and the `pending` skip mechanism is gone, since no Lane needs it.
  - Rejected: a `wedged` flag on the Dead Session path. A wedged main thread can recover, and the runner still answers `status`.

## What shipped

- `native/yoqa-runner/Sources/YoqaRunnerCore/`: `MainThreadGate.swift`; `Device` gains `snapshot`, `typeText`, `keyboardReturn`, `keyboardDelete`, `button`, with `SnapshotNode`, `AppBackgrounded`, `RunnerWedged`; `Session.swift` maps them.
- `native/yoqa-runner/YoqaRunnerUITests/PhoneDevice.swift`: the XCUITest versions, all through the gate.
- `ios-device-lane.ts`: `pageSource`, `type`, `backgroundApp`, and the error messages.
- Tests:
  - `ObservationTests.swift` (9): snapshot shape, bundle id, both errors, input commands, journaling, bad requests, the gate.
  - `ios-device-lane.test.ts` (+7): the Screen, the followed app, both errors, newline, backspace, backgrounding.
  - Lane contract: all 8 `device-ios` tests run.

## How to verify

1. `cd native/yoqa-runner && xcrun swift test` (31 tests).
2. `xcodebuild -project native/yoqa-runner/YoqaRunner.xcodeproj -scheme YoqaRunner -destination 'generic/platform=iOS' build-for-testing CODE_SIGNING_ALLOWED=NO`
3. `bun test services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
4. On a cabled phone (not yet done): open a session with `bundleId` set, `activateApp`, then `pageSource()`; press home and call `pageSource()` again for `APP_BACKGROUNDED`.

## Follow-ups

- **Not run on a phone.** Check the element roles (roles are mapped to `yoqa-ax`'s names; unmapped types are `Other`), that `typeText` on SpringBoard reaches the focused field of the foreground app, and snapshot latency for #251.
- **A snapshot without an app reads SpringBoard.** A session opened without a `bundleId`, before any `activateApp`, can't get `APP_BACKGROUNDED` and shows whatever is in front. The snapshot is one accessibility read ([ios-device-benchmark.md](./ios-device-benchmark.md)), about 0.4 s on a home screen.
- **The gate times the wait for the main thread, not the work.** `run` waits 8 s for the whole closure, so a long-press or drag over about 8 s trips `RUNNER_WEDGED` though the thread is fine. Work that was still queued at the deadline is cancelled and never fires late; work already running is waited for.
- **Snapshots are not paginated.** A huge tree is one reply.
