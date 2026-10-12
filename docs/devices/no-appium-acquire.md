# Session acquire never opens the Appium lane

## Goal

Connecting a device or starting a Run never opens the Appium lane. The Device Session is on the Direct lane, or the connect fails. Ticket [#287](https://github.com/Aris-ngoy/qa-agent/issues/287). Vocabulary: **Lane**, **Device Session**, **Active Session** in [`CONTEXT.md`](../../CONTEXT.md). The Appium lane, the managed Appium Server, and stored capability fields stay until [#288](https://github.com/Aris-ngoy/qa-agent/issues/288) and [#289](https://github.com/Aris-ngoy/qa-agent/issues/289).

This contradicts [ADR-0004](../adr/0004-device-session-lanes.md): a Direct start no longer falls back to Appium, an Appium request is no longer an override, and custom capabilities no longer pin the Appium lane. [#289](https://github.com/Aris-ngoy/qa-agent/issues/289) writes the superseding ADR. Until then, this doc is the record of the contradiction.

## Plan summary

- **One chooser.** `selectLane` opens Direct, or it throws. `auto` and an explicit Direct request both do that. An Appium request throws `The Appium lane cannot be opened`. A missing Direct factory throws `Direct lane is not available`.
- **A failed Direct start is the connect's error.** `openDeviceSession` no longer catches that error and opens Appium, and it does not attach a Lane warning about a fallback.
- **Capabilities do not change the Lane.** A Run adopts a Direct Active Session when the App or Case still has capability keys. It does not quit that session and replace it.
- Rejected: deleting the Appium lane, server, or capability editors in this ticket. Rejected: a new test seam. The existing session-acquire tests, with a fake Lane factory, cover the connect.

## What shipped

- `select-lane.ts`: `selectLane` never returns Appium. `availableLanes` lists only factories that exist.
- `open-session.ts`: the Lane is chosen before the previous session on that device is quit, then Direct is opened. A Direct start error propagates. The Appium factory is not called.
- `active-session.ts`: `acquireSessionForRun` adopts a healthy Active Session on the same device without a capability pin. A fresh connect still goes through `selectLane`.
- `CONTEXT.md`: a connect is Direct or it fails; capabilities do not replace a Direct Active Session.
- The session-acquire test for a cabled iPhone now expects a Stream. The phone's live preview already provides one; the old expectation of no stream was stale.

## How to verify

```bash
bun test services/runner/src/domains/devices/active-session.test.ts \
  services/runner/src/domains/devices/select-lane.test.ts \
  services/runner/src/domains/devices/session-registry.test.ts
```

`yoqa devices connect <id> --platform ios --lane appium` fails with `The Appium lane cannot be opened`. `--lane auto` and `--lane direct` still open Direct when Direct can start. A Run whose App still has capability keys adopts that Direct session.

## Follow-ups

- [#288](https://github.com/Aris-ngoy/qa-agent/issues/288): Apps and Cases no longer have Appium capabilities.
- [#289](https://github.com/Aris-ngoy/qa-agent/issues/289): remove the Appium lane, server, and runtime, and supersede [ADR-0004](../adr/0004-device-session-lanes.md).
