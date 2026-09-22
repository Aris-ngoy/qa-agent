# Stop leftover agent-device sessions on connect

> **Historical:** written for the pre-Argent backends (Appium, then `agent-device`). Both are gone — the Argent backend replaced `agent-device` (see `docs/adr/0004-argent-backend.md`). Kept for history; commands and paths below may no longer exist (the `domains/agent-device/` paths linked below no longer exist).

## Goal

Connecting a device from Yoqa desktop (Inspector, Restart, or a run) should succeed when the device is already claimed by a leftover same-daemon agent-device session such as `cwd:fcfcd77c2e6b136e:ios`, instead of failing with `DEVICE_IN_USE`.

## Plan summary

Yoqa already closes its own named session (`yoqa-{device-slug}`) before `open`. It did not close implicit leftover sessions created by a prior `agent-device open` in the same repo, another agent, or a crashed process.

Decisions:

- On `open`, if agent-device reports same-daemon `DEVICE_IN_USE` (`already in use by session "…"`), close that session address and retry once.
- Prefer the envelope `details.session` field; fall back to the quoted address in the message.
- Do **not** auto-close the cross-workspace flavor (`owned by session X in workspace Y`) — rethrow.
- Keep run-held Active Session 409s unchanged. Do not treat `DEVICE_IN_USE` as a dead session.

Rejected: listing every daemon session up front; stealing a host-global claim via `device release --stale`.

## What shipped

- [`cli.ts`](../../services/runner/src/domains/agent-device/cli.ts) — `isSameDaemonDeviceInUse` / `conflictingSessionAddress`.
- [`session.ts`](../../services/runner/src/domains/devices/session.ts) — `withDeviceInUseTakeover` wraps `openAgentDeviceApp` (connect, activate app, re-foreground).
- Tests: [`cli.test.ts`](../../services/runner/src/domains/agent-device/cli.test.ts), [`session-takeover.test.ts`](../../services/runner/src/domains/devices/session-takeover.test.ts).

No desktop, HTTP, or client API changes. `POST /devices/connect` and run acquisition share this path.

## How to verify

1. Unit tests: `bun test services/runner/src/domains/agent-device/cli.test.ts services/runner/src/domains/devices/session-takeover.test.ts`
2. Leave a leftover implicit session (`agent-device open …` without `--session` in this repo), then Connect in Inspector. The device should connect; runner logs should mention closing `cwd:…`.
3. While a run holds the Active Session, connect/disconnect still returns 409.
4. A workspace-owned `DEVICE_IN_USE` still surfaces (no close).

## Follow-ups

- Auto-releasing cross-workspace host claims (`device release --stale` / `daemon stop`) is still out of scope.
- Desktop toast copy does not name the evicted session.
