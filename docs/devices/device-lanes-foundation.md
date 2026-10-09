# Device lanes foundation: contract, adoption, Direct implementations, wired iPhones

## Goal

Prepare the Lane seam for the faster Direct implementations planned in [`docs/plans/device-lanes/`](../plans/device-lanes/README.md) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233)), without changing what a Run or connector caller sees. Four tickets:

- [#234](https://github.com/Aris-ngoy/qa-agent/issues/234): one Lane contract suite every Lane must pass.
- [#235](https://github.com/Aris-ngoy/qa-agent/issues/235): a Run keeps its Lane on adoption and on a fresh connect.
- [#236](https://github.com/Aris-ngoy/qa-agent/issues/236): the Direct lane picks its implementation, with a loud fallback.
- [#246](https://github.com/Aris-ngoy/qa-agent/issues/246): only wired, connected iPhones are targets.

Governing decisions: [ADR-0001](../adr/0001-device-session-ownership.md) (one Device Session per device, Active Session adoption) and [ADR-0004](../adr/0004-device-session-lanes.md) (Lanes, capability pinning, "fall back once, loudly"). Terms: **Lane**, **Device Session**, **Active Session**, **Dead Session** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **The Lane stays the only seam.** A new implementation is a `LaneFactory` registered inside the Direct lane, not a third Lane name. The Run report still says `appium` or `direct`.
- **Implementation choice is pure.** `directImplementationOrder` (in `select-lane.ts`) decides which implementations to try. `createDirectLane` (in `direct-lane.ts`) tries them in order and records one Lane warning per fallback. Rejected: a per-implementation Lane name, because it would leak into reports and capabilities pinning.
- **Opt-in by env var, per device class:** `YOQA_DIRECT_ANDROID`, `YOQA_DIRECT_IOS_SIMULATOR`. A new implementation is tried only when opted in, until it is marked `promoted`. Naming the existing implementation (`adb`, `idb`) rolls a promoted one back without a code change.
- **Capability pinning on adoption.** A capability-pinned Run never silently adopts a Direct Active Session. It replaces it with an Appium session and says why. A session held by another Run on the same device is never replaced. That request now fails with `SessionBusyError` instead of quitting the other Run's session through per-device exclusivity.
- **Dead device tools.** The Direct lanes now treat "the tool can't run, or says the device is gone" as a Dead Session (`DeadSessionError` plus `onSessionDead`), like the Appium lane already did for a dropped WebDriver session. This applies only after connect, so a failed start is still a start failure that falls back to Appium.
- **Wired iPhones only.** A physical iPhone is a target only when `devicectl` reports a `wired` transport and a `connected` tunnel. Otherwise it is listed with `unavailableReason`. Rejected: hiding non-targets entirely, because the user then can't tell why their phone is missing.

## What shipped

Under `services/runner/src/domains/devices/` unless noted:

- **Lane contract suite** (#234): `lane-contract.test.ts` runs the same behavioral checks against every harness in its `LANES` list. Adding a Lane takes one line. Harnesses live in `lane-harnesses.ts`: Appium (fake WebDriver injected through the new `AppiumLaneDeps.connect`), Android Direct (fake `adb`), iOS-simulator Direct (fake `idb`). The checks:
  - Taps at the 0–1000 corners land on the device edges.
  - Capture-frame leaves the screenshots directory untouched.
  - Screenshot adds exactly one file there.
  - The tree read through `getScreen` is the cleaned 0–1000 Screen.
  - Quit is idempotent.
  - A dead tool surfaces as a Dead Session.
- `lane.ts`: `guardToolLoss` wraps a Direct lane's tool after connect. `android-direct-lane.ts` (`adbLostDevice`) and `ios-direct-lane.ts` (`idbLostDevice`) use it. The iOS screenshot no longer falls back to `simctl` on a Dead Session.
- **Adoption** (#235): `active-session.ts`
  - `acquireSessionForRun` passes the requested Lane on a fresh connect. That request was dropped before.
  - It replaces a non-Appium Active Session when the Run is capability-pinned. The Lane warning reads "Custom Appium capabilities pin the Appium lane; replaced the Direct Active Session".
  - It refuses to touch a session another Run holds on the same device.
- **Direct implementations** (#236):
  - `direct-lane.ts` holds `createDirectLane`, `DirectLaneStartError` and `DIRECT_IMPLEMENTATIONS`. Today that registry has only `adb` and `idb`, both promoted, so behavior is unchanged.
  - `open-session.ts` uses `defaultDirectLane(platform)`. When Appium is the last resort, it keeps the Direct-internal warnings on the session.
  - `select-lane.ts` gains `directImplementationOrder` and `directOptIn`.
- **Wired iPhones** (#246):
  - `devicectl.ts` (`parseDevicectlDevices`) reads both the newer `properties` dictionary and the deprecated `*Properties` fields.
  - `application.ts` uses it, and `includeUnavailable: false` returns only targets.
  - `packages/runner-client` `Device` gains optional `unavailableReason`.
  - The desktop device picker disables such rows and shows the reason. `yoqa devices ios` prints it.
  - Fixtures in `fixtures/devicectl-*.json` are captured from Xcode 27 `devicectl`, with serials and hostnames removed. The `wired` variants are the captured iPhone 15 with its transport set to `wired`.
- Plans in `docs/plans/device-lanes/` are reworded: Lane instead of adapter, `POST /action` with `kind: "tap"`, and no "replace Appium".

## How to verify

1. `bun run test`. Everything passes except `ensureAdhocCodeSignature`, which also fails on the untouched tree (codesign of a compiled binary, unrelated).
2. `bun run check` and `bun run lint:ci`.
3. Focused: `bun test services/runner/src/domains/devices/{lane-contract,select-lane,session-registry,active-session,devicectl}.test.ts`.
4. Manual, iPhone on Wi-Fi only: the iOS device picker lists it greyed out with "Paired over Wi-Fi only…". Plug it in and refresh: it becomes selectable.
5. Manual, capability pinning: connect an Android emulator in the Inspector (Direct), then start a Run whose App sets a capability. The Run report shows `appium` with the replacement warning.

## Follow-ups

- Confirm on a cabled phone that `devicectl` reports `tunnelState: connected` (not `disconnected`) before any Appium or Direct session opens. If a cable alone leaves the tunnel `disconnected`, relax the rule to `wired` plus a non-`unavailable` tunnel.
- `connectDevice` doesn't yet re-check `unavailableReason` for a device id passed straight to the CLI or HTTP.
- The Android Direct lane's cached `getWindowSize` means the adoption health check can't detect a dead adb session. It could probe the tool instead.
