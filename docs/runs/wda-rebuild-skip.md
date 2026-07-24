# Runs panel: Rebuild / Skip (WebDriverAgent)

## Goal

Replace mock build dropdown IDs (which failed with `Build not found`) with a WebDriverAgent policy: **Skip** (reuse) or **Rebuild** (force).

## Plan summary

- Dropdown options: `Skip` | `Rebuild` (default `Skip`).
- **Rebuild** on physical iOS → `setupPlatform` with `force: true` (same as CLI `--force`) before `POST /runs`.
- **Skip** → do not re-force; rely on WDA prepared at device select.
- Runs no longer send fake `buildId`s; install uses the app already on the device.

Rejected: keeping mock CI/TestFlight labels; treating Rebuild as an app-build install.

## What shipped

- [`runs-panel.tsx`](../../apps/desktop/src/mainview/features/devices/runs-panel.tsx) — `WDA_MODES`; Rebuild calls `setupSelectedDevice(..., { force: true })` for iOS physical before `createRun`.
- Run list/detail null `buildId` labels → “App on device”.

Related: [ios/wda-reuse-on-select.md](../ios/wda-reuse-on-select.md).

## How to verify

1. Select app + cases + physical iOS device (first select prepares WDA).
2. Leave **Skip** → Run starts without a full WDA rebuild.
3. Choose **Rebuild** → Run waits on “Rebuilding WebDriverAgent…”, then proceeds; runner logs / setup should show a forced rebuild.
4. Simulator / Android: Rebuild does not force WDA (no physical WDA path); run still starts.
5. No more `Build not found: tf-128` (or other mock IDs).

## Follow-ups

- Persist Skip/Rebuild on the run row for history (optional).
- Real app-build register/install UI when builds catalog is wired in.
