# Narrow the Device Session interface

## Goal

Every Lane (Android adb, iOS simulator, cabled iPhone, web over CDP) re-implemented the same parts of the Device Session: the screenshot, the action lock, the live pointer's tap-or-swipe state machine, the key check, and the device-tool exec helpers. Callers outside `devices/` feature-detected optional members (`session.startRecording`, `session.restartApp`, `session.targetApp?.()`), and an Action a Lane could not do was said three ways: 422 on web, 500 on a cabled iPhone, a missing member elsewhere. See `Device Session`, `Lane` and `Action` in [CONTEXT.md](../../CONTEXT.md), and [ADR-0001](../adr/0001-device-session-ownership.md), [ADR-0005](../adr/0005-direct-only-lane.md), [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **One shared module above a per-Lane driver.** `devices/device-session.ts` builds the `DeviceSession` from a `LaneDriver` (`composeDeviceSession`). Each Lane is now a driver adapter: it implements capture, tree, gestures, keys and the app lifecycle, unlocked; the shared module adds the rest once.
- **A declared capabilities record.** `LaneCapabilities` (`keys`, `targetApp`, `unsupported`) lives on the session. Callers read it instead of checking which members exist. Every member is always present; one the Lane declares unsupported rejects with `ActionUnsupportedError` (422) and the Lane's message. The module checks at build time that each optional member is either implemented or declared unsupported, never both or neither.
- **First, on its own commit:** the cabled iPhone's open-url and alert Actions throw `ActionUnsupportedError` (422), not a plain `Error` (500).
- **Rejected:** a class hierarchy (sessions are spread in `createDirectLane` and mutated by `reportLaneFallback`, so they stay plain objects); keeping optional members with `capabilities` alongside (two sources of truth); folding the web Run-report metadata (`browser`, `browserProfileName`, `viewport`) into a sub-record now, which would edit `runs/application.ts` for no behaviour gain.
- `lane.ts` lines that PR #424 removes (`requestedLane`, `DEAD_SESSION_RE`, Lane selection) are untouched, so the two rebase cleanly.

## What shipped

- `DeviceSession`: 31 members (8 optional) → 30 members (4 optional, all Run-report metadata: `laneWarning`, `browser`, `browserProfileName`, `viewport`). Removed `keySupport` (now `capabilities.keys`), `noRecordingReason` (now `capabilities.unsupported.startRecording`), and `withActionLock` (no caller outside the Lanes). Added `capabilities`. `startRecording`, `restartApp` and `targetApp` are always present.
- `device-session.ts`: the action lock (`createActionLock`, with `queued` / `ready` / `settled` hooks for the iOS simulator's helper start and web's page switch and screen-changed signal), the screenshot, the live pointer (`gesture` replays tap or swipe on release, compared in the driver's own units; `live` forwards each phase), the key check, the default restart-app (terminate then activate, storage kept), and the unsupported-member rejection.
- `device-tool.ts`: `spawnTool`, `requireOk`, `toolFailure`, `ToolResult`, shared by adb, idb and `devicectl`.
- Callers: `interaction.ts` calls `session.restartApp` and `session.targetApp()` directly; `run-recording.ts` reads `capabilities.unsupported.startRecording`; `active-session.ts` calls `targetApp()`.
- Tests: shared behaviour is tested once in `device-session.test.ts` over a fake driver. The Lane contract gained "what the Lane declares it cannot do fails as unsupported, with its reason" and checks `targetApp` against the capability on all 11 harnesses. The iPhone's own lock-order test moved to the shared suite.
- One alignment: a cabled iPhone's activate-app now runs under the action lock, as on every other Lane (it used to run alongside a gesture in flight).

## How to verify

- `bun test services/runner/src/domains/devices/lane-contract.test.ts services/runner/src/domains/devices/device-session.test.ts`
- `bun run lint:ci && bun run check && bun run test`
- On a cabled iPhone, `POST /action` with `open-url` answers 422 "Action not supported".

## Follow-ups

- `lane.ts` keeps its own private `ToolResult` for `guardToolLoss`; fold it into `device-tool.ts` after #424 lands.
- Group the web Run-report metadata (`browser`, `browserProfileName`, `viewport`) into one record with `runs/application.ts`.
- The iOS device lane's Inspector lock reuses `createActionLock`; its unreachable-grace handling could move to the shared module if a second Lane needs it.
