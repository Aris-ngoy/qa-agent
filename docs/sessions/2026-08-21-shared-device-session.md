# Shared device session across run & inspection modes (2026-08-21)

One live Device Session is now shared by every mode. A Run **adopts** the Active
Session when it already targets the same device — no reconnect, no WDA relaunch.
After a run passes, fails, or is cancelled, the session stays live so the user
can inspect immediately. The session remains ready everywhere until the user
disconnects or connects a different device.

## Behavior

- `POST /runs` reuses the Active Session for the requested device; a different
  device replaces the session (device change).
- While a run holds the session: `/action` and WS pointer events return `409`,
  disconnect/connect return `409`, and MJPEG/screenshot/screen reads stay open —
  the inspector becomes a live viewer ("Test run in progress — watching live").
- A second run while one is live gets its own detached session (not Active) and
  quits it at finish; `createRun` rejects when another run is executing.
- The desktop play bar preselects the latest connected device via the shared
  `useActiveDeviceSession()` query (`["devices", "active"]`, 2 s poll while
  connected); the inspector adopts the same query instead of its own bootstrap.

## Code map

- Runner registry + hold/release: `services/runner/src/domains/devices/active-session.ts`
  (`acquireSessionForRun`, `releaseSessionFromRun`, `SessionBusyError`)
- Run acquisition/teardown: `services/runner/src/domains/runs/application.ts`
- HTTP 409 mapping: `services/runner/src/interfaces/http/session.ts`
- UI hook: `apps/desktop/src/mainview/features/devices/use-active-device-session.ts`

Supersedes the contention rule in `docs/adr/0001-device-session-ownership.md`
(per-device exclusivity still holds). Plan: `docs/plans/shared-device-session.md`.
