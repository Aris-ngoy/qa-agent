# Apps and Cases no longer have Appium capabilities

## Goal

An App and a Test Case no longer carry Appium capabilities. The editors for keys such as `appium:autoLaunch` and `appium:appActivity` are gone, and the docs that told people to set them are gone. Ticket [#288](https://github.com/Aris-ngoy/qa-agent/issues/288). Vocabulary: **App**, **Test Case**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md).

Those launch behaviors are dropped. They are not reimplemented on the Direct lane. Starting on the home screen, or on a chosen Android activity, has no capability and no new control.

Keys already saved on an App or Case stay in the catalog column and are ignored. They are not shown, and they do not affect connect, Lane choice, or how an app is launched. Lane choice itself is [#287](https://github.com/Aris-ngoy/qa-agent/issues/287) ([no-appium-acquire](../devices/no-appium-acquire.md)).

This contradicts [ADR-0004](../adr/0004-device-session-lanes.md), which says capabilities keep their documented meaning and are never silently ignored. [#289](https://github.com/Aris-ngoy/qa-agent/issues/289) writes the superseding ADR and removes the Appium lane, server, and runtime. Until then, this doc is the record of the contradiction. The `appium_caps` column stays so existing catalogs still open.

## Plan summary

- **The catalog does not show capabilities.** `getApp` and `getCase` always return `capabilities: []`. A create or update that sends keys does not store them.
- **A Run does not hand stored keys to the Device Session.** `acquireSessionForRun` is called with empty app and case caps, so launch does not read `appium:autoLaunch` or `appium:appActivity`.
- **The editors are gone.** App configuration and Test Case configuration no longer offer capability fields.
- **User-facing docs stop telling people to set them.** The capabilities guide is removed, and the apps, test cases, cross-app, and cross-platform pages no longer point at it.
- Rejected: a new control for home-screen start or an Android launch activity. Rejected: dropping the `appium_caps` column in this ticket. Rejected: deleting the Appium lane (that is #289).

## What shipped

- Catalog reads ignore `appium_caps`. Creates store `[]`. Updates leave the column alone and do not apply a capabilities payload.
- A Run connects with empty caps.
- Desktop App and Test Case forms no longer include the capability editors. The create-app dialog no longer mentions them.
- Public docs and the agent skill connect notes no longer tell people to set Appium capabilities. `CONTEXT.md` records that an App and a Test Case do not carry them.

## How to verify

```bash
bun test services/runner/src/domains/catalog/capabilities.test.ts
```

In the desktop app, App configuration and a Test Case's Configuration tab have no capability fields. `yoqa apps get` / `yoqa cases get` JSON includes `capabilities: []` even when the catalog column still holds old keys.

## Follow-ups

- [#289](https://github.com/Aris-ngoy/qa-agent/issues/289): remove the Appium lane, server, and runtime, drop the leftover `appium_caps` column, and supersede [ADR-0004](../adr/0004-device-session-lanes.md).
