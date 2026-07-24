# iOS WebDriverAgent reuse on device select

## Goal

Stop paying for a full `xcodebuild` rebuild of WebDriverAgent every time a physical iOS device is selected. Reuse prep when signing/Xcode still match; only rebuild when the cache is invalid or the caller forces it.

## Plan summary

**Verify-on-device** with a `--force` escape hatch:

| Condition | Action |
|-----------|--------|
| Prep matches team + Xcode + identity, `.app` exists, WDA on device | Reuse (no build, no install) |
| Prep valid, `.app` exists, WDA missing on device | Reinstall from `~/.yoqa/wda/<udid>` |
| Force, or prep/signing mismatch, or missing `.app` | Full rebuild + install |

Rejected: always-skip without device check (stale prep); always-reinstall (unnecessary `devicectl` cost).

## What shipped

- [`services/runner/src/domains/ios/application.ts`](../../services/runner/src/domains/ios/application.ts) — `prepIsReusable`, `isWdaInstalledOnDevice`, reuse / reinstall / rebuild paths; result `action: "reused" | "reinstalled" | "built"`.
- [`setupPlatform`](../../services/runner/src/domains/appium/application.ts) — passes `force`, returns `wdaAction` + action-aware message.
- [`packages/runner-client`](../../packages/runner-client/src/schemas.ts) — optional `force` on setup request; optional `wdaAction` on response.
- CLI: `yoqa setup ios --force`.
- Desktop: loading copy “Preparing iOS device…”; retry after setup error sends `force: true`.

## How to verify

1. Select a physical iOS device once → full build/install (`wdaAction: built`).
2. Select the same device again (same cert/Xcode) → completes quickly (`wdaAction: reused`).
3. Delete WDA from the device home screen → select again → reinstall from cache (`wdaAction: reinstalled`).
4. `yoqa setup ios --device <udid> … --force` (or desktop retry after error) → full rebuild.
5. Simulator / Android select unchanged.

## Follow-ups

- Dedicated Settings “Rebuild WDA” control (CLI `--force` + error-retry + runs-panel Rebuild cover MVP).
- Optional fingerprint of Appium XCUITest / WDA source version so driver upgrades invalidate the cache automatically.
