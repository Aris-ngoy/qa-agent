# Physical iOS: `YoqaRunner` signs, builds and answers `status`

## Goal

Ticket [#247](https://github.com/Aris-ngoy/qa-agent/issues/247) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ios`](../plans/device-lanes/device-ios.md), second slice). Build the XCUITest runner for a cabled iPhone. Its UI-test method binds `127.0.0.1` on the phone and answers `status`. Signing is part of the slice, because nothing runs on a phone without it.

The first slice, discovery of wired iPhones only ([#246](https://github.com/Aris-ngoy/qa-agent/issues/246)), had already landed with [device-lanes-foundation.md](./device-lanes-foundation.md).

## Plan summary

- **The HTTP core is a Swift package, compiled twice.** `native/yoqa-runner/Sources/YoqaRunnerCore` (`HTTPServer`, `Session`, `startRunner`) builds for macOS, so `xcrun swift test` checks the wire protocol on the host, as #233 asks for resident binaries. `YoqaRunner.xcodeproj` compiles the same folder into its UI-test bundle through a file-system-synchronized group. There are no per-file project entries and no package dependency inside the project. This moves the plan's `Session.swift` and `HTTPServer.swift` out of `YoqaRunnerUITests/`. `Journal.swift` and `MainThreadGate.swift` belong to later slices (journaled gestures, `RUNNER_WEDGED`).
- **Wire format, from the plan.** Every command is `POST /` with `{ "command", "commandId", ... }`. The reply is `{ "ok": true, "data" }`, or `{ "ok": false, "error": { "code", "message" } }`. `status` answers `{ "state": "ready" }`. Errors are `BAD_REQUEST` (unreadable request, not a POST, no `command`) and `UNKNOWN_COMMAND`.
- **The port.** The port comes from `YOQA_RUNNER_PORT`, or the runner takes a system port. Either way it logs `YOQA_RUNNER_LISTENING port=N` once it is listening. The host passes the port as `TEST_RUNNER_YOQA_RUNNER_PORT`, because `xcodebuild` strips that prefix into the runner's environment. It reads the line from `xcodebuild`'s stdout, where the runner's `print` arrives.
- **Signing.** The newest valid Apple Development identity wins. It is matched by SHA-1 between `security find-identity -v -p codesigning` (which needs the private key and drops `CSSMERR_…` identities) and `security find-certificate -a -Z -p`. Expired identities are skipped. The team is the certificate's **OU**, not the ID in parentheses in its name. `YOQA_IOS_TEAM_ID` overrides it. The build is `xcodebuild build-for-testing` with automatic signing, `-allowProvisioningUpdates`, `-allowProvisioningDeviceRegistration` and `-destination id=<udid>`, so a free team registers the phone. The bundle ID is `dev.yoqa.runner.<team>`, so two teams on one Mac never claim the same App ID.
- **Cache.** The cache key is the source hash (the app, the UI tests, the core and the project, without `xcuserdata`), plus `xcodebuild -version` and the team. Builds live in `~/.yoqa/yoqa-runner/<key>/`, with a `build.json` that records the `.xctestrun`, the earliest profile expiry and the phones that every embedded profile lists (read with `security cms -D`). A build is reused only while its profile is valid and it lists this phone. So an expired free profile (about 7 days) rebuilds on the next connect, and so does a new phone.
- **Failures say what to fix.** Every sign, build or start failure is a `YoqaRunnerError`. xcodebuild's `error:` lines, or the `NSError` text of a device-prep wait, come with a fix: unlock the phone, turn on Developer Mode, trust the developer, sign in to the team in Xcode › Settings › Accounts, or set `YOQA_IOS_TEAM_ID`.
- **Not wired to a Lane yet.** `startYoqaRunner` returns the device-side port and a `stop`. Reaching that port from the Mac, and the Direct session on top of it, are [#248](https://github.com/Aris-ngoy/qa-agent/issues/248).

## What shipped

- `native/yoqa-runner/`: the `YoqaRunnerCore` package and its 9 wire and startup tests, plus `YoqaRunner.xcodeproj` (the one-screen host app `YoqaRunner`, the UI-test target `YoqaRunnerUITests` and the shared `YoqaRunner` scheme).
- `services/runner/src/domains/devices/yoqa-runner.ts`:
  - `prepareYoqaRunner`: the team, the cached build, and profile expiry.
  - `startYoqaRunner`: launches `test-without-building -only-testing:YoqaRunnerUITests/RunnerTests/testServe`, then resolves on the listening line or explains why it didn't.
  - `explainBuildFailure` and `yoqaRunnerDeps()`.
- Tests: `yoqa-runner.test.ts` (20) against a fake Mac (keychain, `xcodebuild`, `security cms`), with synthetic signing fixtures in the shape `security` prints.

### Found on the way

- **A UI-test method named `testRun` never runs.** `XCTest` already has a `testRun` property (the current `XCTestRun`), and the method takes over its selector. XCTest calls setUp and tearDown and reports the test as passed in a few ms, but the body never runs. The method is `testServe`.
- **On this Mac, usbmuxd lists no devices.** With macOS 27, Xcode 27 and an iPhone 15 on iOS 27.0.1 on a cable (which devicectl shows as `connected`), `ListDevices` on `/var/run/usbmuxd` returned an empty list, inside the sandbox and outside it. #248 plans to reach the runner through usbmuxd, so it has to confirm that first or use the CoreDevice tunnel.

## How to verify

1. `cd native/yoqa-runner && xcrun swift test`. The `swift` from swiftly is too old.
2. `bun test services/runner/src/domains/devices/yoqa-runner.test.ts`.
3. On a cabled phone with Developer Mode on, unlocked:

   ```ts
   import { startYoqaRunner, yoqaRunnerDeps } from "./services/runner/src/domains/devices/yoqa-runner";
   const runner = await startYoqaRunner("<udid>", yoqaRunnerDeps());
   console.log(runner.port, runner.build); // first connect: action "built"; next: "reused"
   await runner.stop();
   ```

   On 2026-10-10, with an iPhone 15 (iOS 27.0.1), Xcode 27.0 and team RSUD6MW252:

   | Connect | Result | Time |
   | --- | --- | --- |
   | First | `built` | 16 s |
   | Second | `reused` | 3.8 s |
   | `YOQA_IOS_TEAM_ID=ZZZZZZZZZZ` | `YoqaRunnerError` naming "No Accounts" and the Xcode › Settings › Accounts fix | fails fast |
   | Locked phone | "Unlock the iPhone, keep it unlocked, then connect again." | |

   Manual evidence, not reproducible from the repo until #248 reaches the port from the Mac: a throwaway UI test, not committed, POSTed `status` to the logged port from inside the phone. It got `200 {"data":{"state":"ready"},"ok":true}`.

## Follow-ups

- `execCommand` and `xcodebuildErrors` repeat `runCommand` and `summarizeXcodebuildFailure` in `domains/ios/application.ts`. `HTTPServer.swift` repeats about 100 lines of `yoqa-sim`'s HTTP code. Share these when a third copy appears.
- A reused build doesn't re-check that its signing certificate is still valid. A revoked certificate fails at launch instead of triggering a rebuild.

- #248: confirm that usbmuxd lists the phone on macOS 27 / iOS 27 before building the Mac side on it (see above).
- Later `device-ios` slices: gestures, snapshot, screenshot, text, the 64-entry journal, `RUNNER_WEDGED`, and `shutdown`. `shutdown` stops the server, and that ends `testServe`.
