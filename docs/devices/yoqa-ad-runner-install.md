# YoqaADRunner guided install

## Goal

When connecting an iOS device without a signed agent-device runner, show a
dialog that installs the runner (named **YoqaADRunner**, Yoqa icon) instead of
failing with a raw error — the same treatment WebDriverAgent got under Appium.

## Plan summary

- **Decisions:** check-and-install lives inside connect on the runner
  (`createDeviceSession` retries once with `installYoqaRunnerOnDevice` when
  `open` fails with `IOS_RUNNER_NOT_INSTALLED`); the desktop dialog is the
  recovery path when that fails. Detection uses a stable
  `IOS_RUNNER_NOT_INSTALLED` code re-coded from agent-device envelope errors.
  Install = agent-device `prepare ios-runner` + brand the built host app in
  derived data (display name, icons, re-sign with the build's own identity) +
  devicectl/simctl install; verification reads the bundle id **actually
  built**, not just Settings.
- **Rejected:** UI status-gating before connect — an Xcode-managed runner can
  launch fine while absent from `devicectl info apps`, so status `false`
  would force needless installs; connect-first is ground truth. Also
  rejected: patching agent-device sources in `node_modules`; blocking the
  install on branding success (branding is best-effort).

## What shipped

- `services/runner/src/domains/agent-device/runner-install.ts` — status,
  install, branding, prep-record reuse (`~/.yoqa/devices/<udid>.json`),
  stale-copy uninstall so one runner stays on the device.
  Both bundles are branded YoqaADRunner (host app + XCTest companion —
  iOS requires both, so "one runner" means one family, not one app).
- `POST /devices/ios-runner/install`, `GET /devices/ios-runner/status`;
  connect errors carry `code` (`services/runner/src/interfaces/http/`).
- `packages/runner-client` — schemas, `installIosRunner` /
  `getIosRunnerStatus`, `isRunnerNotInstalledError` matcher.
- Desktop `RunnerInstallDialog` + `useRunnerInstall` hook, wired into
  Inspector connect/restart and run start (`apps/desktop/src/mainview/`).
  Picking an iOS device in the Select Device dialog checks the runner and
  installs it inside that same dialog; check-and-install also runs inside
  connect on the runner, with the dialog as the recovery path.
- CLI `yoqa devices install-runner` (`packages/cli/src/program.ts`).
- Runner icon asset `services/runner/assets/yoqa-ad-runner-icon.png` (required
  for the Electrobun sidecar compile).

## How to verify

- Unit: `bun test services/runner/src/domains/agent-device`
  (`cli.test.ts`, `runner-install.test.ts` cover the matcher, envelope
  re-code, bundle-id read, prep matching).
- Checks: `bun run check` in `services/runner`, `packages/runner-client`,
  `packages/cli`, `apps/desktop`; `bunx biome check` on touched files.
- Sidecar: `bun scripts/build-runner-sidecar.ts` in `apps/desktop`.
- Live: `GET /devices/ios-runner/status?deviceId=<udid>&kind=simulator`;
  install on a physical iPhone verified end-to-end (mismatch warning path
  included).

## Follow-ups

- Connect currently adopts whatever runner agent-device builds; if the user
  changes Settings → iOS bundle id afterwards, install converges via one clean
  rebuild (wipes sim caches too — expected, one-time cost).
- No Android equivalent needed (no runner signing on Android).
