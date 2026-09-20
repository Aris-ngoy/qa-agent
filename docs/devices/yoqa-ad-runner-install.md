# YoqaADRunner guided install

## Goal

When connecting an iOS device without a signed agent-device runner, show a
dialog that installs the runner (named **YoqaADRunner**, Yoqa icon) instead of
failing with a raw error — the same treatment WebDriverAgent got under Appium.

## Plan summary

- **Decisions:** detect runner-missing via a stable `IOS_RUNNER_NOT_INSTALLED`
  code re-coded from agent-device envelope errors; install = agent-device
  `prepare ios-runner` + brand the built host app in derived data (display
  name, icons, re-sign with the build's own identity) + devicectl/simctl
  install; verify against the bundle id **actually built**, not just Settings.
- **Rejected:** patching agent-device sources in `node_modules` (fragile across
  upgrades); pre-patching derived caches (agent-device owns them); blocking the
  install on branding success (branding is best-effort, install is not).

## What shipped

- `services/runner/src/domains/agent-device/runner-install.ts` — status,
  install, branding, prep-record reuse (`~/.yoqa/devices/<udid>.json`).
- `POST /devices/ios-runner/install`, `GET /devices/ios-runner/status`;
  connect errors carry `code` (`services/runner/src/interfaces/http/`).
- `packages/runner-client` — schemas, `installIosRunner` /
  `getIosRunnerStatus`, `isRunnerNotInstalledError` matcher.
- Desktop `RunnerInstallDialog` + `useRunnerInstall` hook, wired into
  Inspector connect/restart and run start (`apps/desktop/src/mainview/`).
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
