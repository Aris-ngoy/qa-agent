# Collapse the leftover multi-Lane plumbing

## Goal

[ADR-0005](../adr/0005-direct-only-lane.md) made the [Lane](../../CONTEXT.md) Direct only, but the runner still carried the shape of the multi-Lane era: a `selectLane` that ignored its input, a lane registry keyed by name, a `requestedLane` threaded through four types and read by nobody, a pass-through `createDeviceSession` kept alive as a `mock.module` target, and a Dead Session regex that matched only WebDriver messages. Delete it, so a connect reaches the Direct lane in a few hops and tests cross the real interface.

## Plan summary

- **One Lane factory, not a registry.** `openDeviceSession(options, lane = defaultDirectLane(options.platform))` takes the Lane it opens on. There is nothing to choose, so no chooser.
- **Keep the in-class pick.** `directImplementationOrder` and `directOptIn` stay: the Direct lane still picks its implementation per device class and falls back once, loudly (ADR-0004).
- **Wire contract unchanged.** Connect and Run bodies still accept `lane: "auto" | "direct"` (`@yoqa/runner-client` schemas, CLI, desktop). The runner accepts and ignores it. A Run row still records the requested value, and the Run report still names the Lane that ran (`runs.lane`, from `session.lane`).
- **Injection over module mocks.** The Active Session opens sessions through an `OpenSession` function; `setSessionOpener` swaps it and returns the restore. Its tests now open every session through the real `openDeviceSession` (per-device exclusivity included) on a faked Lane, instead of `mock.module("./session")`, which leaked into later test files and needed a flag to switch itself off.
- **Dead Session by type.** Every Direct lane already reports a gone device with a `DeadSessionError` (`guardToolLoss` on adb and idb_companion, the cabled iPhone's lost `YoqaRunner`, the browser's closed socket or page, the stopped frame loop). Nothing emits the WebDriver strings the regex matched, so `isDeadSessionError` is now `instanceof DeadSessionError`.

Rejected:

- **Keep `selectLane` as an extension point for a future Lane.** A seam with one adapter is a hypothetical seam; ADR-0005 says dead code reachable by an old client is how a fallback returns.
- **Walk the `cause` chain in `isDeadSessionError`.** No wrapper hides a `DeadSessionError` today, and a wrapper such as `DeviceUnreachableError` would then read as dead when it means "still in the grace window".
- **Delete `session.ts`.** It is the import point for the Device Session types across devices and runs; removing it would touch files other work is editing. It is now a type re-export only.
- **Drop the `requested_lane` column.** Old databases must still open; like `appium_caps`, a drop is a separate migration.

## What shipped

- `select-lane.ts`: `selectLane`, `availableLanes`, `LaneRequest`, `LaneChoice` deleted.
- `open-session.ts`: `defaultLanesFor`, `mergeLanes`, `openOnLane` deleted; `openDeviceSession` takes one `LaneFactory`.
- `session.ts`: `createDeviceSession` deleted; tests and callers use `openDeviceSession`.
- `lane.ts`: `SessionOptions.requestedLane` and `DEAD_SESSION_RE` deleted; `isDeadSessionError` checks the type.
- `active-session.ts`: `requestedLane` gone from `connectDevice`, `acquireSessionForRun` and `createAndRegister`; `OpenSession` + `setSessionOpener` added.
- `interfaces/http/session.ts`, `runs/application.ts`: stop passing the requested Lane down.

Connect path, before: route → `connectDevice` → `createAndRegister` → `createDeviceSession` → `openDeviceSession` → `mergeLanes`/`defaultLanesFor` → `availableLanes` → `selectLane` → `openOnLane` → `defaultDirectLane` → `createDirectLane` → implementation.

After: route → `connectDevice` → `createAndRegister` → `openDeviceSession` → Direct lane (`defaultDirectLane` → `createDirectLane`) → implementation.

## How to verify

- `bun run lint:ci`, `bun run check`, `bun run test`.
- `active-session.test.ts`: "a connect that names auto, Direct, or no Lane opens a Direct Device Session" posts each body to `/devices/connect`.
- `session.test.ts`: a plain error saying `invalid session id` is no longer a Dead Session; a `DeadSessionError` is. The lane contract tests ("a dead device tool surfaces as a Dead Session") and the web lane's closed-browser tests still pass.

## Follow-ups

- `select-lane.ts` now holds only the in-class implementation order; renaming it (e.g. `direct-order.ts`) is cosmetic.
- The desktop inspector's `inspect-session.ts` still matches WebDriver words alongside `device session ended` and HTTP 410; the latter two are what the runner sends.
- `docs/devices/benchmark-ios-device-actions.ts` still calls `defaultLanesFor` (it was already stale: `appCaps`).
