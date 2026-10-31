# A tap by id on a system element with no target app fails clearly

## Goal

Ticket [#394](https://github.com/Aris-ngoy/qa-agent/issues/394) (spec [#390](https://github.com/Aris-ngoy/qa-agent/issues/390)). On a cabled iPhone (`device-ios`) with no target app, `yoqa action tap --id 'SBSwitcherWindow:Main'` matched SpringBoard's app-switcher window and tapped it: a silent no-op that looked like a tap on the app. That tap now fails, naming the id, saying no app is targeted, and pointing to setting one.

Builds on [screen-source.md](./screen-source.md) (the Screen's `source`) and [foreground-app.md](./foreground-app.md) (the foreground read).

## Plan summary

- **Where.** In `performAction`, the Action seam the runner HTTP API (and so the CLI, batches and `--screenshot`) goes through. A tap by id that matches an element in a tree whose source is `system`, while the Device Session has no target app, throws `ActionValidationError` (HTTP 400) and reaches nothing on the phone.
- **Only by id.** Taps by x,y never read the tree and are unchanged. Taps by label are unchanged too, as the ticket asks: a label can name a system dialog's button. An id in the target or the foreground app's tree taps as before, and so does an id with a target app set.
- **A Screen with no source** (every other Lane, or an agent step that passes its own elements) is never refused. A `device-ios` reply without `source` from an older runner is already `system` with no target app, so it is refused too.
- **Order.** The id is looked up first: an id in no tree is still `No element matching id`.

## What shipped

- `interaction.ts`: `performAction` refuses a tap by id on an untargeted system tree, with "No app is targeted, and `<id>` is a system (SpringBoard) element, not an app's. Set a target app (`yoqa action activate-app --app-id <bundle id>`, or pick the app in the Inspector) and tap again."
- The skill's inspect reference says a tap by `--id` on a system tree fails until an app is targeted.
- Tests, in `ios-device-lane.test.ts`, through `performAction` against the fake phone (+5): a system id with no target app fails naming the id and taps nothing; so does a reply without `source`; with a target app it taps; an id in the foreground app's tree taps; a label and an x,y tap on the system tree tap as before.

## How to verify

1. `bun test services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/interaction.test.ts`
2. On a cabled iPhone, connect with no app, open the app switcher, and run `yoqa action tap --id 'SBSwitcherWindow:Main'`: it fails with the message above. `yoqa action activate-app --app-id <bundle id>`, then a tap by one of the app's ids lands.

## Follow-ups

- The iOS Simulator Lane (`yoqa-ax`) reports no source, so a tap by a SpringBoard id there is not refused.
