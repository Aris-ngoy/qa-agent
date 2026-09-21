# Servers panel + yoqa doctor

## Goal

Give operators a Play-adjacent control to list/stop/restart the yoqa-runner and device sessions, and a shared `yoqa doctor` diagnostics report in the CLI, a quick panel, and Settings → Diagnostics.

## Plan summary

- **Servers scope:** yoqa-runner and the active device session (Argent owns the device backend; there is no local Appium process).
- **Stop all safety:** disconnects the device session; does **not** kill yoqa-runner (would brick the live UI). Runner Stop/Restart goes through desktop RPC with confirmation.
- **Doctor:** one report schema for CLI, Play-adjacent Doctor tab, and Settings Diagnostics — runtime checks, host probes, Argent server probe, and ordered repair steps.

Rejected: killing the runner from `POST /servers/stop-all`, and auto-running full doctor on every boot beyond existing splash `ensureRuntime`.

## What shipped

### Runner

- [`services/runner/src/domains/servers/application.ts`](../../services/runner/src/domains/servers/application.ts) + `GET/POST /servers*`
- [`services/runner/src/domains/doctor/application.ts`](../../services/runner/src/domains/doctor/application.ts) + `GET /doctor`, `POST /doctor/repair`

### Client + CLI

- Schemas/methods on `@yoqa/runner-client`
- `yoqa servers` / `list` / `stop-all` / `stop` / `restart`
- `yoqa doctor` / `yoqa doctor --fix` / `--json`

### Desktop

- RPC `stopLocalRunner` / `restartLocalRunner`
- Servers & Doctor popover next to Play ([`servers-doctor-panel.tsx`](../../apps/desktop/src/mainview/features/devices/servers-doctor-panel.tsx))
- Settings → **Diagnostics** tab (`?section=diagnostics`)

## How to verify

1. Start runner (`bun run runner` or desktop app).
2. `yoqa servers` — should at least show `runner-self`.
3. Connect a device or start a run; `yoqa servers` lists the device session; Stop/Restart from UI or CLI.
4. `yoqa doctor` — color bullet list (green pass / red fail / yellow warn) plus next steps; `yoqa doctor --json` for raw JSON; `yoqa doctor --fix` only runs allowlisted repairs.
5. Desktop: open Servers button left of Play → list / stop all / select stop|restart; Doctor tab → **Run doctor** (manual) → Refresh / Repair; Open Diagnostics.
6. Settings → Diagnostics → **Run doctor** / Refresh / Repair safe issues (Repair is enabled only when a step has a safe repair, and disabled while a repair is running).

## Follow-ups

- Deeper iOS signing / team probes in doctor.
- Optional CLI respawn of yoqa-runner after kill (desktop RPC remains preferred while the app is open).
