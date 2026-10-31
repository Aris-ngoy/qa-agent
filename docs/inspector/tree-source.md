# The Inspector shows where the tree came from, and a "No target app" state

## Goal

Ticket [#393](https://github.com/Aris-ngoy/qa-agent/issues/393) (spec [#390](https://github.com/Aris-ngoy/qa-agent/issues/390)). On a cabled iPhone with no target app, the Inspector showed SpringBoard's elements (such as `SBSwitcherWindow:Main`) as if they were the app's. The Device panel now says which app the tree was read from, and when it is SpringBoard's because the Device Session has no target app, it says so and offers the app selector instead of SpringBoard's elements.

Builds on [devices/screen-source.md](../devices/screen-source.md) (the Screen's `source`). Terms are in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Panel state is a pure helper.** `treePanelFor` in `features/inspector/utils/tree-source.ts` maps the Screen's `source`, whether the Device Session has a target app, and the system toggle to one of three panels: `tree` (the elements, as before), `no-target-app` (the app selector, no elements), or `system` (SpringBoard's elements, revealed by the toggle). The label reads `Reading <bundle id> (target)`, `Reading <bundle id> (foreground)`, or `System (SpringBoard)`; a Screen with no source has no label and renders as before.
- **A system tree with a target app set** is shown as read, labelled: the session already names an app, so the next read is that app's.
- **The target-app state comes from the runner.** `GET /devices/active` gains `targetApp`, read from the Lane through an optional `DeviceSession.targetApp()` (filled by the Lanes that remember an app: `device-ios`, the simulator's idb Lane, Android). It follows connect, retarget, a Run adopting the session, and `activate-app`.
  - Rejected: deriving it from the app selected in the side menu. A session opened from `yoqa devices connect` without an app has none while the side menu has one selected, which is the case this ticket is about.
- **Choosing an app** in the selector selects it in the side menu, which retargets the session as before (`useRetargetOnAppSwitch`). When it is already the selected app, the selector retargets the session itself (`useRetargetSession`, now shared with the top bar). When the session's `targetApp` changes, the feed reads the tree again, so the panel shows the chosen app without waiting for the next refresh.
- **State** follows [desktop-feature-layout.md](../architecture/desktop-feature-layout.md): the Screen's `source` and the toggle live in the feed observable (`feed$.source`, `feed$.showSystemTree`), reset on detach. Hiding SpringBoard's elements drops a selection on one.

## What shipped

- `@yoqa/runner-client`: `activeDeviceResponseSchema.targetApp`.
- Runner: `DeviceSession.targetApp?()`; `ActiveSessionInfo.targetApp`.
- Desktop: `utils/tree-source.ts` (`treePanelFor`, `treeSourceLabel`, `treePanelElements`); `hooks/use-tree-panel.ts`; `components/tree-source-bar.tsx` (the label, the "Show SpringBoard elements" switch, the "No target app" card with the app selector). The Device panel hit-tests and the element dialog cycles only the elements the panel shows.
- Tests:
  - `tree-source.test.ts`: every source (none, target, foreground, system) × target app or none × toggle on or off, the labels, and the hidden elements.
  - `active-session.test.ts` (+1): `GET /devices/active` names a cabled iPhone's target app, and none once it is forgotten.
  - Lane contract (+1 per Lane): a Lane that names its target app names the one it was last pointed at.

## How to verify

1. `bun test apps/desktop/src/mainview/features/inspector/utils/tree-source.test.ts services/runner/src/domains/devices/active-session.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
2. On a Mac with a cabled iPhone: `yoqa devices connect <udid>` with no app, open the Inspector and connect it. With the home screen in front, the panel shows `System (SpringBoard)` and "No target app"; clicking the screen selects no element. Turn on **Show SpringBoard elements**: they hover and select. Choose an app in the selector and open it on the phone: the panel reads `Reading <bundle id> (target)` and the app's elements select.
3. On a simulator, Android or web, the panel shows no source line and behaves as before.

## Follow-ups

- Not checked by hand on a Mac (built in a Linux sandbox).
- The `foreground` source comes from the candidates slice of #390; this panel already labels it.
