# With no target app, read the app in the foreground on a cabled iPhone

## Goal

Ticket [#392](https://github.com/Aris-ngoy/qa-agent/issues/392) (spec [#390](https://github.com/Aris-ngoy/qa-agent/issues/390), second slice). On a cabled iPhone (`device-ios`), a Device Session with no target app read SpringBoard, so an app opened by hand on the phone (testemall in the report) showed only system elements. With no target app the tree now comes from the app actually in the foreground, and the Screen says so with source `foreground`.

Builds on [screen-source.md](./screen-source.md) (the Screen's `source`) and [ios-device-observation.md](./ios-device-observation.md) (the `snapshot` command). Terms are those of [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Wire.** `snapshot` takes either `bundleId` (the target app, as before) or `candidates` (bundle ids, sent only with no target app). With `candidates`, the runner checks each one's state in order and reads the first one running in the foreground, with source `{ kind: "foreground", bundleId }`. With none in front it reads SpringBoard, source `system`, as before. `bundleId` wins when both are sent.
- **Never changes the phone.** A candidate's state is read through `XCUIApplication(bundleIdentifier:).state`, which neither launches nor activates the app. A candidate that leaves the foreground between the check and the read (`AppBackgrounded`) gives SpringBoard, not an error: without a target app there is no app to name.
- **The candidates.** The phone's user apps from `xcrun devicectl device info apps --json-output`, listed once per Device Session (`remember`). The ones built by a developer go first, since the app under test is usually one of them and the check stops at the first match. Hidden apps, app clips and `YoqaRunner`'s own test host are left out.
  - A list that fails is warned about once and left empty for the session, so the tree reads SpringBoard. Rejected: listing again on the next read, which would run `devicectl` on every Inspector poll while it keeps failing.
- **A foreground app is not the target app.** Finding one does not set the Device Session's target app: the next read sends `candidates` again, so the tree follows whichever app is in front, and `backgroundApp` brings back no app. Only the user's selection, an activation, or a Run adopting the session sets it.
- **A target app is unchanged.** The Lane sends `bundleId` only and does not list the phone's apps; a target app in the background is still `APP_BACKGROUNDED`, naming that app.
- **Older runners** ignore `candidates`, read SpringBoard and name no source; the Lane's fallback already calls that `system`.

## What shipped

- `devicectl.ts`: `parseDevicectlApps`, the bundle ids of the phone's user apps.
- `ios-device-lane.ts`: with no target app, `snapshot` sends the installed user apps as `candidates`, listed once per Device Session.
- `Device.swift`: `isInForeground(_:)`; `PhoneDevice` reads the app's state only. `Session.swift`: `snapshot` reads the first candidate in the foreground, with source `foreground`.
- The `device-ios` harness of the Lane contract lists no apps, so its tree read stays the system's.
- Tests:
  - `ios-device-lane.test.ts` (+5, 2 tightened): `candidates` and no `bundleId` with no target app; a `foreground` source reaches the Screen; one app listing per Device Session; a foreground app does not become the target app; a failed listing reads the system once warned; a target app sends `bundleId` only, and `APP_BACKGROUNDED` still names it.
  - `devicectl.test.ts` (+2): the app list's order and what it leaves out, on a `devicectl-apps.json` fixture.
  - `ObservationTests.swift` (+5): the first foreground candidate is read as `foreground`; none in front gives SpringBoard as `system`; `bundleId` wins over `candidates`; a candidate that leaves the foreground gives SpringBoard; a snapshot only checks states and reads one tree.

## How to verify

1. `bun test services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/devicectl.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
2. `cd native/yoqa-runner && xcrun swift test` (on a Mac; not run in the Linux sandbox this was built in).
3. On a cabled iPhone, connect with no app, open testemall by hand on the phone, and run `yoqa screen`: the first line is `Read from com.example.testemall (foreground app)` and the elements are testemall's. Go to the home screen: it reads `Read from the system (SpringBoard), not an app`. In the Inspector, testemall's elements can be selected.

## Follow-ups

- The Inspector's "No target app" state with the app selector (the rest of #390).
- An app installed during the Device Session is not a candidate until the next session.
- Each candidate's state is one XCUITest query; a phone with many user apps pays for each on a home-screen read. Measure on a phone, and check that `state` really leaves a not-running app alone.
- `ObservationTests.swift` was not run here (no Swift toolchain on Linux).
