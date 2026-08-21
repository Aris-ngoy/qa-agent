# Plan — Shared Device Session across Run mode & Manual/UI Inspection

Status: proposed
Scope: `services/runner` (devices, runs, HTTP), `apps/desktop` (play bar, inspector), docs
Platforms: Android + iOS (no platform-specific logic; all seams are platform-agnostic)

---

## 1. Goal

One live Device Session per device, shared by every mode:

- Connect once (home/devices screen, test cases play bar, or inspector) → the session stays live everywhere.
- Switching between AI run mode and manual/UI inspection never forces a reconnect.
- The **latest connected device** is preselected on the play bar automatically.
- The session stays ready in every surface until the user **manually disconnects** or **connects a different device**.

## 2. Current behavior (why it hurts)

| Friction | Where |
|---|---|
| A Run always creates its own session and evicts the Active Session for that device | `services/runner/src/domains/runs/application.ts:421-429` via `createDeviceSession` → `releaseExistingSession` (`domains/devices/session.ts:598`) |
| A finished/cancelled run unconditionally quits its session → inspector must reconnect from scratch | `runs/application.ts:524-529` (`finally { session.quit() }`) |
| Connecting in the inspector during a live run kills the run | `active-session.ts:80-82` + exclusivity release listener (`active-session.ts:68-72`) |
| Play bar keeps device selection component-local; never reflects the connected device | `apps/desktop/src/mainview/features/devices/runs-panel.tsx:233` |
| Inspector warns "run is live (separate Appium session)… won't share" | `inspector/session-toolbar.tsx:168-173` |
| No shared UI state for the active session (only per-feature local state) | inspector-page.tsx:149-150, runs-panel.tsx:233 |

Governing decision today: [ADR 0001](../adr/0001-device-session-ownership.md) — "Run and Active Session contend; starting one releases the other on that device." This plan supersedes that contention rule.

## 3. Design

### 3.1 Runner: the Active Session becomes THE shared session

New acquisition rule in `executeRun` (`runs/application.ts`):

```
acquireSessionForRun(run):
  active = getActiveSession()
  if active && active.deviceId === run.deviceId:
      adopt it (mark heldByRun)
  else:
      connectDevice({ deviceId: run.deviceId, … })   // replaces any other session
      mark heldByRun
```

Teardown rule in the `finally` block:

```
if session is NOT the current Active Session:
    quit it            // parallel-run edge case only
else:
    clear heldByRun    // keep the session live for inspection
```

Consequences:

- Pressing play reuses the inspector's session (no reconnect, no WDA relaunch).
- After a run passes/fails/is cancelled, the session stays live → user can immediately inspect what just happened.
- Connecting a different device anywhere replaces the session (existing `connectDevice` semantics already do this).

### 3.2 Runner: run-held sessions are view-only interactively

Add a `heldByRun` flag to the Active Session registry:

- `POST /action` and WS `/ws/control` pointer events → `409 Conflict` ("A run is using this session — cancel it to interact manually").
- `GET /stream.mjpeg`, `GET /screenshot/image`, `GET /screen` stay allowed → the inspector becomes a **live viewer** of the running case instead of being locked out.
- `POST /devices/disconnect` while heldByRun → `409` ("Cancel the run first").
- On Dead Session mid-run: existing abandon path clears everything (unchanged).

### 3.3 Runner: concurrency guard

- Reject starting a second run on the same device while one is live (`409`, surfaced as a toast). Runs on *different* devices keep working in parallel (their sessions simply aren't the Active one and get quit at finish per 3.1).

### 3.4 Remove the contention wiring

- Delete the exclusive-release listener registration in `active-session.ts:68-72` (runs no longer steal the session).
- Keep the per-device-id map in `session.ts` (still guarantees ≤1 session per device).
- Update ADR 0001 (supersede note) + CONTEXT.md glossary entries for Active Session / Run.

### 3.5 Desktop: shared session state

- New hook `useActiveDeviceSession()` (TanStack Query key `["devices", "active"]`, queryFn = `client.getActiveDevice()`) in `mainview/features/devices/`.
- Invalidate on connect/disconnect/run-start/run-finish so every surface updates together.

### 3.6 Desktop: play bar shows the latest connected device

`runs-panel.tsx`:

- Initialize/preselect `device` from `useActiveDeviceSession()` whenever the active session changes and the user hasn't explicitly picked another device this session.
- Device picker gains a **Connect** action (calls `POST /devices/connect` after setup) so pressing play can rely on an existing session; if no session exists at play time, the runner creates one transparently (3.1).

### 3.7 Desktop: inspector reflects shared reality

- Remove the "separate Appium session" warning (`session-toolbar.tsx:168-173`); replace with:
  - normal Connected/Live pill when idle,
  - a **view-only banner** ("Run in progress — watching live") when `useActiveRun().isRunLive && session.heldByRun`.
- Disable action affordances (command bar, script Run button, pointer send) while heldByRun; keep MJPEG feed running.
- Keep mount-time adoption of the existing Active Session (already implemented at `inspector-page.tsx:483-508`), now matched against the shared hook instead of local state.

## 4. Files touched

Runner:

- `services/runner/src/domains/devices/active-session.ts` — heldByRun flag, remove contention listener, expose `isSessionHeldByRun()`
- `services/runner/src/domains/runs/application.ts` — acquire/adopt logic, teardown rule, same-device concurrency guard
- `services/runner/src/interfaces/http/session.ts` — 409 mapping for action/disconnect while held
- `services/runner/src/interfaces/http/control-ws.ts` — drop pointer events while held
- `services/runner/src/interfaces/http/runs.ts` — conflict error shape for duplicate run

Desktop:

- `apps/desktop/src/mainview/features/devices/use-active-device-session.ts` (new)
- `apps/desktop/src/mainview/features/devices/runs-panel.tsx` — preselect latest device, Connect action
- `apps/desktop/src/mainview/features/inspector/inspector-page.tsx` — use shared hook, view-only mode
- `apps/desktop/src/mainview/features/inspector/session-toolbar.tsx` — banner replaces warning

Docs:

- `docs/adr/0001-device-session-ownership.md` — superseded-by note
- `CONTEXT.md` — glossary tweak (Active Session is shared; Run adopts it)
- `docs/sessions/` — short feature note

## 5. Edge cases

| Case | Behavior |
|---|---|
| Run targets a different device than the active session | Old session replaced by `connectDevice` (user changed device) |
| Case-level caps differ from how the session was created | Session still reused when deviceId matches (sharing wins; caps documented as best-effort on reuse) |
| Run dies mid-flight (dead session) | Existing abandon path clears Active Session; UI toast unchanged |
| Cancel run | Session stays live, heldByRun cleared |
| Second run, same device | 409 with actionable message |
| Second run, different device | Allowed; its session is not Active and is quit at finish |
| Disconnect requested during run | 409 "Cancel the run first" |
| Appium server restart | Existing bridge abandons session (unchanged) |

## 6. Verification

1. Unit: `active-session` heldByRun transitions; run acquire/adopt/teardown matrix (reuse vs replace vs parallel).
2. HTTP tests: 409s for action/disconnect/duplicate-run while held.
3. Manual (Android emulator + iOS simulator):
   - Connect in inspector → press play in test cases → no reconnect (watch MJPEG show the run).
   - After run finishes → inspector still connected, interactive again.
   - Connect from play bar → switch to inspector → session already live.
   - Disconnect in inspector → play bar selection clears.
   - Change device in play bar → old session replaced everywhere.
