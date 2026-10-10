# device-ios

XCUITest runner for a cabled iPhone. USB only. The physical-iOS Direct implementation, next to the Appium lane's WebDriverAgent (not instead of it). Physical iOS reaches Direct only through an explicit `direct` request until this Lane beats the Appium lane in the benchmark. Simulator HID does not exist on hardware, so this package shares no code with `device-sim`.

Start only after `device-android` has landed its Direct implementation.

## First slice

Discovery, not the Xcode project.

- `xcrun devicectl list devices`.
- Refuse anything that is not wired and `connected`. `paired` over Wi-Fi is not a target.
- Stop there.

## Second slice

A test that binds loopback and answers `status`.

Layout:

```text
YoqaRunner.xcodeproj
  YoqaRunner/            host app, one screen
  YoqaRunnerUITests/     the runner
    Session.swift
    HTTPServer.swift
    Journal.swift
    MainThreadGate.swift
```

As built (#247), `Session.swift` and `HTTPServer.swift` live in `Sources/YoqaRunnerCore/`, a Swift package the UI-test target compiles too, so the wire protocol is tested on the host. The test method is `testServe`. See [yoqa-runner-status.md](../../devices/yoqa-runner-status.md).

The test method starts the server and waits. Bind `127.0.0.1` on the device. Port from `YOQA_RUNNER_PORT`, or a system port logged as `YOQA_RUNNER_LISTENING port=N`.

Signing is part of this slice. Nothing runs without it.

- Apple Development identity from the keychain, newest wins.
- Override with `YOQA_IOS_TEAM_ID`.
- `xcodebuild build-for-testing`, automatic signing, `-allowProvisioningUpdates`.
- Cache by source hash, Xcode version, and team.
- A free profile expires in about 7 days. Next connect rebuilds.

## Third slice

The Mac connects through `/var/run/usbmuxd`.

- `ListDevices` maps UDID to DeviceID.
- `Connect` opens the runner port.
- HTTP runs on that socket.
- A `status` call must cross the cable before any gesture is written.

As built (#248), see [ios-device-usbmux.md](../../devices/ios-device-usbmux.md). On macOS 27 / iOS 27 usbmuxd does list a cabled iPhone as `USB`.

## Later slices

Gestures and observation, each in its own file: `Session+Gestures.swift`, `Session+Snapshot.swift`, `Session+Screenshot.swift`, `Session+Text.swift`.

Commands, one POST each, body `{ "command", "commandId", ... }`:

`viewport`, `tap`, `longPress`, `drag`, `type`, `keyboardReturn`, `keyboardDelete`, `snapshot`, `screenshot`, `button`, `status`, `shutdown`.

Response is `{ "ok": true, "data" }` or `{ "ok": false, "error": { "code", "message" } }`. Mutating commands are journaled, 64 entries. A lost reply calls `status` with `statusCommandId` and does not send the gesture again. `snapshot` of a backgrounded app returns `APP_BACKGROUNDED` and does not steal focus. A stuck main thread returns `RUNNER_WEDGED`.

Lifecycle stays `xcrun devicectl`.

As built (#249): `viewport`, `screenshot`, `tap`, `longPress`, `drag` and the journal. See [ios-device-actions.md](../../devices/ios-device-actions.md).

## Done

Connect, snapshot, tap, and screenshot work on a phone with Developer Mode on, and a retried tap does not fire twice.

## Out of scope

Pinch, rotate, paste, shake, screen recording, dylib injection, iPad, Wi-Fi.
