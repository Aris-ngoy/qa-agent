# The Screen's source: which app a tree was read from

## Goal

Ticket [#391](https://github.com/Aris-ngoy/qa-agent/issues/391) (spec [#390](https://github.com/Aris-ngoy/qa-agent/issues/390), first slice). On a cabled iPhone (`device-ios`) with no target app, the tree is SpringBoard's, and its elements (such as `SBSwitcherWindow:Main`) passed for the app's. Every tree read on that Lane now says which app it came from, through the Lane, the runner HTTP API and `yoqa screen`.

Builds on [ios-device-observation.md](./ios-device-observation.md) (the `snapshot` command).

## Plan summary

- **Screen contract.** A Screen, cleaned or full, has an optional `source: { kind: "target" | "foreground" | "system", bundleId?: string }` (`screenSourceSchema` in `@yoqa/runner-client`). `target` is the Device Session's target app, `foreground` the app found in front without one ([foreground-app.md](./foreground-app.md)), `system` SpringBoard. A Lane that does not report a source leaves it unset; today only `device-ios` reports it. The Screen itself is in [`CONTEXT.md`](../../CONTEXT.md).
- **Wire.** The runner's `snapshot` reply adds `source`: `{ kind: "target", bundleId }` when asked with a `bundleId`, `{ kind: "system" }` without one.
- **Older runners.** A reply without a valid `source` is `target` (with the bundle id sent) when the Lane sent one, and `system` otherwise, so a runner built before this keeps working.
- **How it travels.** The Lane writes `source` into the raw tree's JSON, next to `elements` and `degraded`, so `pageSource()` keeps its one string and the full Screen carries it as is. The Screen read takes it back out (`screenSourceOf` for a full read, `cleanIdbCompleteSource` for the cleaned one).
  - Rejected: a separate `screenSource()` on the Device Session. It would be a second read, or a remembered value that a later read could get ahead of.
- **CLI.** `yoqa screen` leads with one line, `Read from com.demo (target app)`, `Read from com.demo (foreground app)`, or `Read from the system (SpringBoard), not an app`, and prints none when the Screen has no source. `--json` and `--full` carry `source`.

## What shipped

- `@yoqa/runner-client`: `screenSourceSchema` / `ScreenSource`; `screenResponseSchema` gains `source`.
- `Session.swift`: the `snapshot` reply carries `source`.
- `ios-device-lane.ts`: the source, or the fallback, goes into the tree through `yoqaAxTreeToSource`.
- `screen.ts`: `CleanedScreen.source` and `screenSourceOf`; `interaction.ts`: `getScreen` returns it.
- `yoqa screen` prints the source line. The skill's inspect reference says what the line means.
- Tests:
  - `ObservationTests.swift` (+2): the `target` and `system` source on the reply.
  - `ios-device-lane.test.ts` (+2): the runner's source reaches the Screen; a reply without one falls back.
  - Lane contract (+1 per Lane): a tree read, cleaned and full, has the source the harness names; unset everywhere but `device-ios`.
  - `screen-source.test.ts` (5): the CLI line for each kind, none when unset, and `--json`.

## How to verify

1. `bun test services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts packages/cli/src/screen-source.test.ts`
2. `cd native/yoqa-runner && xcrun swift test` (on a Mac; not run in the Linux sandbox this was built in).
3. On a cabled iPhone, connect with no app and run `yoqa screen`: the first line is `Read from the system (SpringBoard), not an app`. `yoqa action activate-app --app-id <bundle id>`, then `yoqa screen` reads `Read from <bundle id> (target app)`.

## Follow-ups

- The rest of [#390](https://github.com/Aris-ngoy/qa-agent/issues/390): with no target app, send the installed user apps as `candidates` and read the foreground one (`foreground`), done in [foreground-app.md](./foreground-app.md); the Inspector's "No target app" state.
- The iOS Simulator Lane (`yoqa-ax`) reports no source yet.
- `ObservationTests.swift` was not run here (no Swift toolchain on Linux).
