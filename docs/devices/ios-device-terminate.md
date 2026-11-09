# Terminate and restart an App on a cabled iPhone

## Goal

Ticket [#420](https://github.com/Aris-ngoy/qa-agent/issues/420). On a cabled iPhone (`device-ios`), `yoqa action terminate-app --app-id <id>` and `yoqa action restart-app --app-id <id>` failed with "Terminating an app is not available on the physical-iOS Direct lane yet", and so did any Test Case or Run step that restarts the App. Both now work, as on an iOS simulator and Android.

Fills one of the gaps left by the [`device-ios` plan](../plans/device-lanes/device-ios.md) ("Lifecycle stays `xcrun devicectl`"). Restart is defined in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **devicectl, not the runner.** `YoqaRunner` is unchanged: no rebuild or re-sign, and a terminate does not need the runner's main thread. A runner `terminate` command (`XCUIApplication.terminate()`) was rejected for that reason.
- **Bundle id to pid.** `devicectl device process terminate` takes a pid. The Lane asks `device info apps --bundle-id <id> --include-all-apps` where the app is installed (its `url`), then finds the process in `device info processes` whose executable is directly inside that bundle. The app's extensions run from `PlugIns/` and `Extensions/` inside the bundle and are left alone.
- **The app is looked up for each terminate**, not taken from the list the Lane keeps per Device Session ([foreground-app.md](./foreground-app.md)). That list is read once, leaves out system apps, and a reinstall moves the bundle, which would make a running app look stopped. `--include-all-apps` also covers system apps such as Settings.
- **SIGTERM, wait, SIGKILL.** After `process terminate --pid`, the process list is polled every 250 ms until the pid is gone, for up to 3 s. A pid still there gets `--kill` and one more check; if it survives that, the terminate fails naming the app.
- **Not running** is success with no terminate sent. **Not installed** is an error naming the app, so a wrong bundle id is not reported as terminated.
- **A listing that fails** (cable, tunnel, unreadable JSON) is a `devicectl` error, never "not running".
- **Restart** is the default path, terminate then `activateApp` (`devicectl device process launch`); the Lane has no `restartApp`. `launch --terminate-existing` was rejected: a second way to kill an app, and "not supported on all platforms". The Action's result now carries `storage: "kept"` on this path, on every Lane that uses it (simulator and Android too).
- **Lock and target app.** Terminate runs under the Lane's action lock. It does not clear the target app, and the Device Session stays connected.

## What shipped

- `devicectl.ts`: `parseDevicectlAppUrl`, `parseDevicectlProcesses` (null for unreadable output) and `appMainProcess`. The fixture `devicectl-processes.json` is cut down from a real capture on an iPhone 15 (Xcode 27, devicectl 642.16): `result.runningProcesses[]` of `{ executable: "file://…", processIdentifier }`.
- `ios-device-lane.ts`: `terminateApp`, and the `terminateGraceMs` dependency (3 s by default) for the wait before SIGKILL.
- `interaction.ts`: `restart-app` without a Lane `restartApp` reports `storage: "kept"`.
- `CONTEXT.md`: **Restart (an App)**.
- Tests: the parsers against the captured shape; the Device Session against the fake phone (SIGTERM only, not running, SIGKILL, survives SIGKILL, failed process list, not installed, session and target app after, the action lock); the Actions `terminate-app` and `restart-app` through `performAction`.

## How to verify

1. `bun test services/runner/src/domains/devices/devicectl.test.ts services/runner/src/domains/devices/ios-device-lane.test.ts`
2. On a cabled iPhone with the App open: `yoqa action terminate-app --app-id <bundle id>` closes it; run it again and it still succeeds. `yoqa action restart-app --app-id <bundle id>` brings up a fresh launch, still signed in.

Checked by hand on an iPhone 15 (iOS 27): `devicectl device process terminate --pid` on a running app sent SIGTERM and the pid was gone from the next process list.

## Follow-ups

- A Screen read of a terminated target app still says `APP_BACKGROUNDED`; a "not running" message would be clearer.
- Opening a URL, and accepting or dismissing an alert, are still "not available yet" on this Lane.
- Each check costs one `devicectl` call (about a second), so a terminate is three or four of them.
