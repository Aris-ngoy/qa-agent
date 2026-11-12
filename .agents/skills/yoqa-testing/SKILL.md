---
name: yoqa-testing
description: Yoqa (`yoqa` CLI) drives iOS/Android devices and simulators, and web apps in a Chromium browser. Use when the user wants to look at or act on a device or browser screen, write or edit Yoqa test cases and flows, or run saved test cases.
---

# Yoqa

The `yoqa` CLI drives an iOS or Android device or simulator, or a web page in a Chromium browser. Pick
the branch that matches the request and follow its workflow file through to its **Done when**.

| Branch | The user wants | Needs | Workflow |
|---|---|---|---|
| **Debug** | you to drive the screen: explore, reproduce a bug, check a fix | a connected device | [Debug on device](workflows/debug-on-device.md) |
| **Author** | test cases, reusable flows, tags or app context created or edited | a connected device, for the debug-run | [Author test cases](workflows/test-cases.md) |
| **Run** | saved cases run by the Yoqa agent, with a report | a connected device + an AI provider | [Run saved cases](workflows/run-tests.md) |

A one-off command (list devices, register a build, export a report) needs no workflow: go straight to
its file in [Commands](#commands).

## Start of every branch

1. `yoqa status --json` — the runner, the AI provider, and the active device. Any command starts the
   local runner if it is down.
2. `yoqa apps list` — where a command is written with `APP`, pass that app's `PREFIX`.

An AI provider is needed only for the Run branch and for `--description`. When one is missing, ask the
user to set it in the Yoqa app (Settings → Provider); Debug carries on without it on the first two
rungs of the ladder.

## Targeting ladder

How `tap` and `input` find their target. Start on rung 1; step down one rung after two misses.

1. **Point** — `--x` / `--y` read off a fresh `yoqa screenshot`, at the centre of the control. Reaches
   everything the screenshot shows: custom-drawn UI, games, system sheets. Swipe and drag exist only on
   this rung. [Actions by coordinates](references/actions-coordinates.md)
2. **Identifier** — `--id` or `--label` read from `yoqa screen --json`, or known from the app's code.
   Deterministic, but blind to a system sheet covering the app.
   [Targeting elements](references/actions-grounding.md)
3. **Description** — `--description`: a vision model locates the element. Needs an AI provider.

A **miss** is a tap that changed nothing or a target that was not found. After a miss, take a fresh
screenshot and change the attempt: move the point, answer the sheet or dialog covering the app, scroll
the target into view, or step down a rung. Each attempt differs from the one before it. When the
screenshot and `yoqa screen` disagree, the screenshot is right.

## Conventions

- **Coordinates** are relative `0–1000` on both axes, `0,0` at the top-left — on every platform.
- **Units**: `--duration` and `--settle` are milliseconds; `--timeout` is seconds.
- **`--json`** whenever you parse output; the human format is terse and changes.
- **`--screenshot`** on any action waits for the screen to settle and returns the result screenshot in
  the same call. Use it on every action in a game or canvas.
- **Web** is a third platform: the device is an installed Chromium browser, the app is its Web URL, and
  there is nothing to build or install. [Devices › Web browsers](references/devices.md#web-browsers)

## When blocked

- **Device or session unhealthy** ("not reachable", "no active session", a connect that hangs):
  `yoqa doctor --fix`, then `yoqa status`; if a session is still stuck, `yoqa devices disconnect` and
  connect again. If that fails too, ask the user to run `yoqa serve` or open the Yoqa desktop app.
- **Something Yoqa-related this skill does not cover**: https://yoqa.arisn.dev/llms.txt

## Guardrail

Every catalog write and every delete waits for the user's explicit yes: `apps update`,
`cases create/update/delete`, `flows create/update/delete`, `builds delete`, `runs delete`. Show
exactly what you will send (the full text, title, tags and flows file) or name exactly what you will
delete (number or id, plus its title or name). Deletes are irreversible; delete only what the user
asked to remove.

## Commands

| File | Covers |
|---|---|
| [Environment](references/environment.md) | `status`, `health`, `serve`, `doctor`, `servers`, `--base-url` |
| [Devices](references/devices.md) | list, connect, active, disconnect; web browsers and viewport presets; the user's Everyday browser; iPhone signing |
| [Inspect & App Control](references/inspect-and-app-control.md) | `screenshot`, `screen`, app lifecycle, `open-url`, `alert`, `key` |
| [Actions by coordinates](references/actions-coordinates.md) | tap, input, swipe, drag by point; `--screenshot`; `action batch` |
| [Targeting elements](references/actions-grounding.md) | `--id`, `--label`, `--description` |
| [Assertions](references/assertions.md) | `assert visible` / `not-visible` |
| [Apps, Cases & Flows](references/apps-cases-and-flows.md) | `apps`, `cases`, `flows`, `tags`; the flows file |
| [Builds](references/builds.md) | the build registry; producing a binary for [iOS](references/builds-ios-native.md), [React Native](references/builds-react-native.md), [Android](references/builds-android.md) |
| Install | putting a build on a device and resetting app state: [iOS](references/install-ios.md), [Android](references/install-android.md) |
| [Run Tests](references/run.md) | `runs`, `report`, Case Scripts (`script export/validate/run`) |
