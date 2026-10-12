# Remove the Appium lane, server, and runtime

## Goal

Yoqa no longer installs, starts, or checks an Appium Server. A Lane is Direct only. A connect result, a Run report, and the session pill never name Appium. Ticket [#289](https://github.com/Aris-ngoy/qa-agent/issues/289). Vocabulary: **Lane**, **Device Session**, **Dead Session** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0005](../adr/0005-direct-only-lane.md), which supersedes [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- **Delete, do not hide.** [#287](../devices/no-appium-acquire.md) stopped choosing the Appium lane and [#288](../catalog/no-appium-capabilities.md) stopped the capabilities that pinned it. This ticket removes the lane, its server, its runtime installer, and everything that only served them.
- **`LaneName` becomes `direct`** in the runner and in `@yoqa/runner-client`, so a client cannot name Appium at all.
- **Keep what Direct uses.** The Android SDK and JDK env and host-tool PATH helpers move out of `appium/` into `domains/android-toolchain/`. The physical-iPhone UDID check moves to `devices/ios-udid.ts`.
- Rejected: leaving the WebDriverAgent prep under `ios/`. Nothing but the Appium lane used it.
- Rejected: dropping the `appium_caps` column here. That is a migration of its own.

## What shipped

- **Runner.** Removed `domains/appium/` (server, runtime, driver install), `domains/ios/` (WebDriverAgent prep), `devices/appium-lane.ts`, the WebDriver `keyboard.ts`, the `/runtime` routes, and `POST /devices/setup`. `/status` no longer reports a runtime. The runner does not start or stop an Appium Server at boot or shutdown. `webdriver` and `webdriverio` are no longer dependencies.
- **Servers and Doctor.** Servers lists the runner and the device session only. Doctor checks Java, Xcode tools, adb, and the device session; it reports no Appium install, foreign Appium process, or managed server, and its only repair is disconnecting a stuck session.
- **Session options.** `appCaps` and `caseCaps` are gone from the session path; the catalog still returns `capabilities: []`.
- **Client.** `laneNameSchema` is `direct`; the runtime, setup, driver, and Appium server schemas are gone.
- **CLI.** `--lane` accepts `direct` or `auto`. `yoqa runtime` and `yoqa setup` are removed. `yoqa status` no longer prints a runtime line.
- **Desktop.** The pill reads `Live · Direct` or `Connected · Direct`. The boot gate no longer installs drivers. Restart no longer offers a WebDriverAgent rebuild. Android toolchain settings say they feed the Direct lane.
- **CI and docs.** The demo workflows no longer cache or install the Appium runtime and connect without `--lane appium`. The agent skill no longer documents the runtime commands.

## How to verify

```bash
bun run test
bun run check
grep -rniE "appium" apps/desktop/src packages/cli/src services/runner/src packages/runner-client/src --include='*.ts' --include='*.tsx' | grep -v test
```

The grep should list only the catalog's leftover `appium_caps` column. In the desktop app, connect a device: the pill says `Direct`, Servers lists no Appium, and Doctor has no Appium checks. `yoqa devices connect <id> --platform android --lane appium` fails with `--lane must be direct or auto`.

## Follow-ups

- Drop the `appium_caps` column from `apps` and `cases` with a migration.
- Prune the historical Appium design in [`ARCHITECTURE.md`](../../ARCHITECTURE.md) and the older notes under `docs/` that describe the Appium lane.
