# Plan — Argent parity backend (agent-device -> Argent)

Status: shipped
Scope: `services/runner` (argent adapter, devices, runs, HTTP), desktop copy, docs
Platforms: iOS sim/device + Android emu/device parity only. No TV, no Chromium/CDP, no profiling/flows in this cut.
Base: ADR `0004-argent-backend.md`. Argent `0.25.2` enumerated via `argent tools`.

## What shipped (ticket 5: argent-cutover)

* `domains/devices/session.ts` delegates to `createArgentDeviceSession` (same exported names; `activity` passthrough; `restartApp` on the session type); steal path, `withDeviceInUseTakeover`, and the YoqaADRunner check-and-install are gone. `isDeadSessionError` covers `isDeadArgentSessionError`.
* `interaction.ts` `restart-app` prefers `session.restartApp`, else terminate+activate; `terminate-app` surfaces the Argent unsupported error.
* Builds install via `reinstall-app --udid --bundleId --appPath` (bundle id from the run's app, else the build record; actionable error when unknown).
* Doctor/runtime/status/devices/session HTTP rewired to `argent/*` (`argent` runtime check id, `setupArgentPlatform` verify, `argent-server` doctor probe). `/devices/ios-runner/*` stay as explicit 410s (same paths/schemas, so old clients get an actionable message). Developer Mode gate and iOS signing overlay dropped; host PATH + Android SDK env kept under `domains/host/`.
* `runtimeCheckIdSchema` gains first-class `argent` (`agent-device` kept for old payloads).
* `domains/agent-device/` deleted. Desktop copy points at Argent (signing sections marked removed) with telemetry opt-out; CONTEXT glossary updated.

## How to verify

1. `bun run lint:ci`, `bun run test`, `bun run check` green (minus the pre-existing unrelated `opencode.test.ts` model-list failure, confirmed identical on `main` via `git stash`).
2. Manual: connect + screen + tap + type on one iOS sim and one Android emu via `yoqa` CLI; Settings/doctor show Argent.

## Follow-ups

* Remove the desktop iOS-signing pipeline (preferences, RPC, sidecar env) and the YoqaADRunner install dialog flow (never triggers post-cutover).
* Decide whether `/devices/ios-runner/*` 410s and the `yoqa devices install-runner` stub stay or are deleted with the `agent-device` server kind and `agentDeviceVersion` wire names.
* Physical-iPhone cross-app steps still gate with an actionable single-app error (carried over).

---

## 1. Goal

Replace the `agent-device` CLI subprocess with Argent behind the same Device Session interface. `yoqa devices/screen/action/runs` contracts stay stable, coords stay 0–1000 at the API boundary.

License: Argent source Apache-2.0; `bin/<platform>/simulator-server`, `bin/darwin/ax-service`, `native-devtools-ios/*.dylib` are proprietary — Yoqa must not vendor, bundle, decompile, or redistribute. Global user install only: `npx @swmansion/argent@latest init`. Telemetry opt-out surfaced.

## 2. Tool map (Argent 0.25.2 -> Yoqa)

| Yoqa need | agent-device today | Argent parity |
|---|---|---|
| list targets | `devices --platform` (`domains/agent-device/devices.ts:53`) | `argent run list-devices` (udid/serial, kind emulator/device, booted-first) |
| readiness | `doctor --remote` / `--platform` (`domains/agent-device/runtime.ts:155,185`) | `argent server status` + `list-devices`; keep `doctor` shape, new hints |
| connect | open named session (`domains/devices/session.ts:195,204`) | `launch-app --udid --bundleId` registers target; no persistent named session; ActiveSession stores `{udid, bundleId}` |
| disconnect | `close --session` (`session.ts:173,277`) | `stop-simulator-server` per-device only where owned; otherwise clear registry (never `stop-all-simulator-servers` implicitly) |
| screen tree | `snapshot -i` (`session.ts:335`) | `describe --udid` (AX/uiautomator, frames 0–1); map to 0–1000 cleaned tree. Cache last tree since each Argent action already returns one |
| screenshot | `screenshot path` (`session.ts:405,429`) | `screenshot --udid [--scale]` |
| tap/double | `press x y` (`session.ts:601,605`) | `gesture-tap --udid --x 0-1 --y 0-1 [--clickCount]`; divide Yoqa 0–1000 by 1000 |
| swipe/scroll | swipe args | `gesture-swipe --fromX/--fromY/--toX/--toY --durationMs --momentum`; `momentum:false` for deterministic settle loops |
| type/keys | input/keyboard | `keyboard --text | --key`; never both in one call; type+enter via `run-sequence`; secrets via `{{secret:NAME}}` server-side |
| open-url/deeplink | open-url | `open-url --udid --url`; `launch-app` preferred for known bundleId |
| install/reinstall | `install/reinstall path` (`domains/builds/application.ts:134,142,154`) | `reinstall-app --udid --bundleId --appPath` (.app/.apk; clears data) |
| lifecycle | activate/terminate/restart | `launch-app` / `restart-app --udid --bundleId [--activity Android]` |
| hw buttons | back/home/keyboard | `button --button home|back|...`; `keyboard --key` for enter/backspace |
| settle/wait | sleep/poll | `await-ui-element --condition exists|visible|hidden|text --selector-json` + `await-screen-idle` in case executor |
| batch | sequential CLI calls | `run-sequence` only when steps known upfront; else individual calls |

Out of scope: `tv-remote`, Chromium `gesture-scroll/drag`, `debugger-*`, `native-profiler-*`, `react-profiler-*`, `flow-*`, `screenshot-diff`, `view-network-*`, `screen-recording-*`, `paste` (sim/emu only — keep behind capability check or defer).

## 3. Design

New `services/runner/src/domains/argent/` adapter:

* `cli.ts` — `resolveArgentBin()`, `runArgentTool(name, args)` via `argent run` JSON, `ArgentError` with Dead-Session codes mapped from transport failures (no `DEVICE_IN_USE` steal path — Argent has no named-session conflict).
* `runtime.ts` — `getArgentRuntimeStatus()`, `ensureArgentBackend()`; hints point to `npm install -g @swmansion/argent`, never to vendored paths.
* `devices/session.ts` keeps interface (`connect/quit/screenshot/getScreen/press/swipe/...`); internals call Argent tools with `--udid`. Per-device exclusivity stays; same-daemon steal logic (`isSameDaemonDeviceInUse` in `agent-device/cli.ts:105`) is deleted with the old adapter.
* Coords: boundary 0–1000; adapter converts `/1000` on write, `*1000` on read from `describe` frames.
* Physical iPhone limits carried over: single-app scope (register via `launch-app`; springboard for system dialogs), no iPad; cross-app flows that worked under agent-device must gate or fail with actionable message.

## 4. Files touched

Runner:

* `services/runner/src/domains/argent/cli.ts` (new), `runtime.ts` (new), `devices-map.ts` (new: describe->cleaned tree)
* `services/runner/src/domains/devices/session.ts`, `screen.ts`, `interaction.ts`, `application.ts` — swap calls, keep signatures
* `services/runner/src/domains/devices/active-session.ts` — drop steal path
* `services/runner/src/domains/builds/application.ts` — install via `reinstall-app`
* `services/runner/src/domains/doctor/application.ts`, `interfaces/http/runtime.ts`, `interfaces/http/devices.ts`, `index.ts` — readiness copy
* `services/runner/src/domains/agent-device/` — delete after parity green (separate ticket)

Desktop/docs:

* Settings/Diagnostics/Android copy: agent-device -> Argent, telemetry opt-out
* `CONTEXT.md` glossary: `agent-device CLI` -> `Argent backend`
* `docs/devices/remove-appium.md` follow-up note

## 5. Edge cases

| Case | Behavior |
|---|---|
| Argent not installed | `TOOL_MISSING` + `npm install -g @swmansion/argent` hint; no auto-install |
| Physical iPhone cross-app step | 409/actionable: register target app first; document single-app scope |
| Type+Enter | single `run-sequence`, never two bare `keyboard` calls (screenshot/secret semantics) |
| Swipe determinism | scroll-to-element loops use `momentum:false` + `durationMs>=150` |
| Disconnect | never call `stop-all-simulator-servers` from disconnect path |
| Telemetry | `argent telemetry disable` documented; `--no-telemetry` noted for team installs |

## 6. Verification

1. `bun run lint:ci`, `bun run test`, `bun run check` green.
2. `argent tools` parity matrix: list/connect/describe/screenshot/tap/swipe/type/key/open-url/install/restart/button/wait on one iOS sim + one Android emu.
3. Case-executor suite passes unchanged against Argent adapter (abort/settle/script-vs-agent).
4. Desktop Settings/doctor show Argent + telemetry opt-out, no agent-device references outside history.

## 7. Tickets (blockers-first)

1. `argent-runtime` — bin resolve, `server status`, runtime/doctor mapping, telemetry copy.
2. `argent-session` — connect/disconnect registry, Dead-Session mapping, physical-iPhone single-app guard.
3. `argent-screen` — describe->0–1000 tree, screenshot, grounding compat.
4. `argent-actions` — tap/swipe/keyboard/sequence/open-url/install/lifecycle/buttons/wait parity.
5. `argent-cutover` — case-executor regression, desktop copy, delete `domains/agent-device/`, CONTEXT + docs.
