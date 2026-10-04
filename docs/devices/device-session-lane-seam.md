# Device Session Lane seam

## Goal

Make **Lane** a real seam in the device layer (see `Lane` in [`CONTEXT.md`](../../CONTEXT.md) and [ADR-0004](../adr/0004-device-session-lanes.md)) without changing behaviour, so a Direct lane can be added behind it. Ticket [#180](https://github.com/Aris-ngoy/qa-agent/issues/180).

## Plan summary

- `DeviceSession` is a lane-neutral interface; the Appium lane is its only implementation.
- Appium-specific state stops leaking through the type: the webdriverio `browser` handle is gone from it, and the flat `mjpegPort` / `streamReady` pair becomes `stream: LiveStream | null` (a lane without a live feed reports `null`).
- The per-device exclusivity rule from [ADR-0001](../adr/0001-device-session-ownership.md) moves out of the Appium code into the dispatcher, so every future lane gets it for free.
- Rejected: moving the registry into each lane (each lane would re-implement ADR-0001), and keeping `mjpegPort` / `streamReady` on the session (a Direct lane has no such fields).

## What shipped

All under `services/runner/src/domains/devices/`:

- `lane.ts`: `DeviceSession`, `LaneName`, `LiveStream`, `LaneFactory`, `SessionOptions`, and the dead-session helpers. No runtime dependencies. `DeviceSession.lane` names the Lane (`"appium"`).
- `appium-lane.ts`: everything that moved out of the old `session.ts` (WebDriverAgent / UiAutomator2 capabilities, MJPEG port and probe, the pointer gate). Exposes `createAppiumSession`.
- `open-session.ts`: the per-device registry and `openDeviceSession`, which quits any existing session on the device, calls the lane factory, and removes the session from the registry when it is quit.
- `session.ts`: unchanged public surface (`createDeviceSession`, `mergeCapabilities`, `isDeadSessionError`, types). `createDeviceSession` is a thin wrapper over `openDeviceSession`; the wrapper keeps `mock.module("./session")` in `active-session.test.ts` from patching the real dispatcher.
- Consumers: `active-session.ts` derives `streamReady` / `mjpegPort` from `session.stream`; the `/stream.mjpeg` route proxies `session.stream.upstreamUrl`. The HTTP wire format is unchanged.
- Tests: `session-registry.test.ts` covers the dispatcher with an injected fake lane (lane recorded, one session per device, different devices coexist, quit deregisters, a failing lane registers nothing).

## How to verify

1. `bun run test`: all pass except `ensureAdhocCodeSignature`, which also fails on `main` (codesign of a compiled binary; unrelated).
2. `cd services/runner && bun run check` and `bunx biome ci services/runner/src`.
3. Manual: connect a simulator or emulator in the desktop app. The Inspector live stream, taps and a Run behave as before.

## Follow-ups

- [#187](https://github.com/Aris-ngoy/qa-agent/issues/187): Lane selection is implemented; see [connector-speed.md](./connector-speed.md).
- [#189](https://github.com/Aris-ngoy/qa-agent/issues/189): Android Direct lane; see [android-direct-lane.md](./android-direct-lane.md).
- The `/stream.mjpeg` 503 message still says "Appium MJPEG broadcaster"; reword for a Direct session (`stream: null`).
