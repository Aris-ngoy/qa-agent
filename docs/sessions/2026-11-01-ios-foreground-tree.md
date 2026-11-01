# The Inspector on a cabled iPhone reads the app, not SpringBoard

## Goal

Spec [#390](https://github.com/Aris-ngoy/qa-agent/issues/390). On a cabled iPhone (`device-ios`), the Inspector could not find or select any element of an app opened by hand (testemall in the report). Its tree held only SpringBoard's elements, such as `SBSwitcherWindow:Main`, and `yoqa action tap --id 'SBSwitcherWindow:Main'` was a silent no-op. The cause: with no target app, the snapshot quietly read SpringBoard. This change reads the app in the foreground instead, labels every tree with where it came from, and makes the untargeted case visible.

Terms are those of [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Four tracer-bullet tickets**, worked by Sandcastle ([sandcastle.md](../agents/sandcastle.md)) on the integration branch `inspector/ios-foreground-tree`:
  - [#391](https://github.com/Aris-ngoy/qa-agent/issues/391) came first. It gives the Screen a `source`.
  - [#392](https://github.com/Aris-ngoy/qa-agent/issues/392), [#393](https://github.com/Aris-ngoy/qa-agent/issues/393) and [#394](https://github.com/Aris-ngoy/qa-agent/issues/394) each depend only on #391.
- **The target app still wins.** Finding the foreground app never sets the Device Session's target app, and a target app in the background is still `APP_BACKGROUNDED`. Rejected alternative: making the foreground app the target automatically. That would let an unrelated app take over a Run's target.
- **Test seams.** Two, both existing:
  - The physical-iOS Lane against the fake phone.
  - The runner's `snapshot` command over a fake `Device`.
  The Inspector's panel rule is a pure helper with its own unit tests.

## What shipped

Each slice has its own doc with the decisions and rejected alternatives:

- **Screen source** ([screen-source.md](../devices/screen-source.md)). The runner's `snapshot` reply, the Screen, the runner HTTP API and `yoqa` inspect all carry `source: { kind: "target" | "foreground" | "system", bundleId? }`. A reply from an older runner without `source` falls back to `target` or `system`.
- **Foreground app** ([foreground-app.md](../devices/foreground-app.md)). With no target app, the Lane sends the phone's user apps, listed once per session through `devicectl`, as `candidates`. The runner reads the first one in the foreground without activating it.
- **Inspector tree source** ([tree-source.md](../inspector/tree-source.md)):
  - The Device panel shows which app the tree came from.
  - A system tree with no target app shows "No target app" with the app selector.
  - A switch reveals SpringBoard's elements.
  - `GET /devices/active` gains `targetApp`.
- **System element tap** ([system-element-tap.md](../devices/system-element-tap.md)). A tap by id that only matches a system element while no app is targeted fails with HTTP 400 naming the id. Taps by x,y and by label are unchanged.

## How to verify

- `bun run lint:ci`, `bun run check` and `bun run test` pass. Locally, `opencode.test.ts` "lists models when opencode is installed" fails the same way on `main`: it depends on the `opencode` CLI installed on the machine.
- By hand, on a Mac with a cabled iPhone:
  1. Run `yoqa devices connect` without an app. The Inspector shows "System (SpringBoard)" and "No target app".
  2. Open the app under test by hand. The Inspector shows "Reading <bundle id> (foreground)" with the app's elements, and you can select them.
  3. Run `yoqa action tap --id 'SBSwitcherWindow:Main'` from the home screen with no target app. It fails, naming the id.

## Follow-ups

- The iOS Simulator Lane (`yoqa-ax`) reports no `source` yet. A SpringBoard-only tree there is still unlabelled, and a tap on a SpringBoard id there is not refused.
- The by-hand check on a cabled iPhone has not been run yet.
