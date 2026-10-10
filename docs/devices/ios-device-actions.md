# Physical iOS: tap, screenshot and the journal

## Goal

Ticket [#249](https://github.com/Aris-ngoy/qa-agent/issues/249) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ios`](../plans/device-lanes/device-ios.md), fourth slice). Tap, long-press, drag and screenshot work on the physical-iOS Direct lane through `POST /action`, with 0–1000 coordinates. Gestures are journaled on the phone (64 entries). A lost reply is resolved with `status` and is never resent, so a flaky cable can't double-tap. The Lane joins the Lane contract suite with the runner faked.

Builds on [ios-device-usbmux.md](./ios-device-usbmux.md) (the tunnel and the session) and [yoqa-runner-status.md](./yoqa-runner-status.md) (the runner).

## Plan summary

- **Fractions on the wire.** The Lane converts 0–1000 to 0.0–1.0 at its edge, as it does for `yoqa-sim`. The runner turns a fraction into an `XCUICoordinate` with `withNormalizedOffset` on SpringBoard, whose frame is the whole screen whichever app is in front. The screenshot is the whole screen too, so window space and screenshot space convert the same way and need no size.
- **Commands.** Each command is one POST of `{ command, commandId, ... }`:

  | Command | Fields | `data` |
  | --- | --- | --- |
  | `viewport` | | `{ width, height }` in points (`UIScreen.main.bounds`) |
  | `screenshot` | | `{ png }`, base64 (`XCUIScreen.main.screenshot()`) |
  | `tap` | `x`, `y` | `{}` |
  | `longPress` | `x`, `y`, `durationMs` | `{}` |
  | `drag` | `fromX`, `fromY`, `toX`, `toY`, `pressMs`, `durationMs` | `{}` |
  | `status` | optional `statusCommandId` | `{ state: "ready", command?: { state: "pending" \| "done" \| "unknown", reply? } }` |

  New error codes: `DEVICE_ERROR` (500, the phone couldn't do it) and `COMMAND_PENDING` (409, a repeated id whose first send is still running). A fraction outside 0–1, a missing duration, or a gesture without a `commandId` is `BAD_REQUEST`.
- **The journal lives in the core package.** `Journal.swift` keeps the last 64 gesture ids with their replies. A repeated id gets the recorded reply and never fires again. `Session` drives a `Device` protocol: `PhoneDevice.swift` in the UI-test bundle implements it with XCUITest on the main thread, and the package's tests fake it. So the journal and the wire are tested on the host.
- **Lost replies.** `send(command, fields, { journaled: true })` on the link: when a gesture went out and its reply didn't come back (closed tunnel, timeout), the link asks `status` with `statusCommandId`. It takes the recorded reply when `done`, polls every 100 ms while `pending` (up to the command timeout), and fails with `COMMAND_LOST` (`… never reached YoqaRunner and was not sent again`) when `unknown`. That is a command error, not a Dead Session: the runner just answered `status`. If the tunnel never opened, nothing was sent, so there is nothing to look up. Reads (`screenshot`, `viewport`) are not journaled. A lost read is just unreachable.
- **Gesture mapping.** A tap held longer than 80 ms is a `longPress` (the Android Direct lane's threshold). A swipe is a `drag` that holds 50 ms. A drag holds 500 ms first, so iOS picks the item up. The runner turns `durationMs` into an `XCUIGestureVelocity` from the distance in points. Live pointer events end as a tap or a swipe, as on the iOS-simulator lane.
- **Dead Session.** A runner the cable no longer reaches (`YoqaRunnerUnreachableError`) fires `onSessionDead` once and rejects with `DeadSessionError`, the same as `guardToolLoss` does for adb and idb. During `quit` it doesn't.
- **The contract's tree test is skipped for this Lane.** The harness declares `pending: { tree: "#250" }`, and the suite skips that one test, naming the ticket. Every other contract test runs.
  - Rejected: pulling `snapshot` into this slice. #250 owns it, together with `APP_BACKGROUNDED`.
- **`continueAfterFailure = true`** in `testServe`, so a gesture XCUITest records as a failure doesn't stop the runner.

## What shipped

- `native/yoqa-runner/Sources/YoqaRunnerCore/`: `Device.swift` (`Device`, `Fraction`, `DeviceError`), `Journal.swift`, and the `viewport`, `screenshot`, `tap`, `longPress`, `drag` and `status` lookup commands in `Session.swift`. `startRunner` takes the `Device`.
- `native/yoqa-runner/YoqaRunnerUITests/PhoneDevice.swift`: the XCUITest `Device`.
- `yoqa-runner-link.ts`: journaled sends and lost-reply resolution.
- `ios-device-lane.ts`: `captureFrame`, `screenshot`, `getWindowSize`, `tap`, `swipe`, `drag` and `pointerEvent`. The tree, typing, alerts and the rest of app lifecycle still reject with "not available … yet".
- `lane-harnesses.ts` and `lane-contract.test.ts`: the `device-ios` harness (a fake runner over HTTP) and per-harness `pending` skips.
- Tests:
  - `GestureTests.swift` (13): the wire, the journal (repeat, pending, eviction at 65) and device errors.
  - `yoqa-runner-link.test.ts` (+5): lost reply resolved, pending, recorded error, never reached, reads not looked up.
  - `ios-device-lane.test.ts` (+4): fractions, long-press, swipe vs drag, viewport.
  - Lane contract: 7 tests for `device-ios`, 1 skipped (#250).

## How to verify

1. `cd native/yoqa-runner && xcrun swift test` (22 tests).
2. `xcodebuild -project native/yoqa-runner/YoqaRunner.xcodeproj -scheme YoqaRunner -destination 'generic/platform=iOS' build-for-testing CODE_SIGNING_ALLOWED=NO` builds the UI-test bundle with `PhoneDevice`.
3. `bun test services/runner/src/domains/devices/yoqa-runner-link.test.ts services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
4. On a cabled phone (not yet done for this slice: on 2026-10-10 both phones were Wi-Fi `paired` only), open a session as in [ios-device-usbmux.md](./ios-device-usbmux.md#how-to-verify), then:

   ```ts
   await s.tap(500, 500);
   await s.tap(500, 500, { durationMs: 1000 }); // long-press
   await s.swipe(500, 800, 500, 200);
   console.log((await s.captureFrame()).base64.length, await s.getWindowSize());
   ```

## Follow-ups

- **Not run on a phone yet.** Check that SpringBoard-relative coordinates land correctly while another app is in front, and in landscape, and measure tap and screenshot latency for #251.
- **A late request can still fire after `unknown`.** Closing the tunnel doesn't recall bytes already on the phone, so a request that arrives after the `status` lookup runs, though the Mac reported `COMMAND_LOST`. The window is the time between the lost reply and `status`.
- **XCUITest failures aren't errors yet.** With `continueAfterFailure = true`, a gesture XCUITest fails on is recorded as a test failure, `PhoneDevice` returns normally, and the journal stores `ok`. `DEVICE_ERROR` today only comes from a `Device` that throws.
- **A caller that retries gets a new command id.** The journal protects within one `send`. An Action that is retried after a `DeadSessionError` is a new command and fires again. Nothing in the runner retries gestures today.
- **Long gestures.** A long-press or drag longer than about 20 s (10 s reply timeout, then 10 s of `pending`) ends as unreachable.
- The Dead Session wrapper in `ios-device-lane.ts` repeats `guardToolLoss`'s notify-once shape for thrown errors, and `pointerEvent` and `fraction` repeat the iOS-simulator lane's.
- #250: `snapshot`, typing, `APP_BACKGROUNDED`, `RUNNER_WEDGED` (the main-thread gate). Until then a stuck main thread shows up as a 10 s timeout, and then as a Dead Session.
- `getWindowSize` is cached for the session, as on the other Lanes, so it no longer fails the Active Session health check. A rotated phone keeps its first size.
- `screenshot()` (persist under the run screenshots directory) is now a third copy, with the iOS-simulator and Android lanes.
