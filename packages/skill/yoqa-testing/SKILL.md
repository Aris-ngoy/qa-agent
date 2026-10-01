---
name: yoqa-testing
description: Use this skill when the user wants to boot and interact with iOS or Android devices/simulators — inspect the screen, execute actions, run UI tests, or manage test cases via the Yoqa platform.
---

# Yoqa Device Testing

Yoqa controls iOS/Android devices and simulators through the `yoqa` CLI. There are two modes of
interaction: you drive the device yourself (debug), or the Yoqa agent runs saved test cases for you.

Pick one workflow below by what the user wants. Follow that workflow's file — it links to the exact
commands in `references/`.

## Before you start

1. **Check readiness** — `yoqa status` reports the runner, Appium runtime, AI provider, and active device
   in one shot. Any command other than `yoqa serve` starts the local runner automatically, so you rarely
   need to start it by hand.
2. **Find the app & its prefix** — run `yoqa apps list` and note the `PREFIX`. Most catalog commands take
   the prefix as their first argument. See [Apps, Cases & Flows](references/apps-cases-and-flows.md).
3. **Configure a provider only if you need one** — `--description` grounding and agent runs require an AI
   provider (Settings → Provider). Targeting by `--id` / `--label`, assertions, and everything in test
   management work without one.

| Need | Requirement |
|---|---|
| Debug on device (screenshot + `--x` / `--y`, or `--id` / `--label`) | Runner + connected device |
| Debug with `--description` grounding | Runner + connected device + AI provider |
| Assertions (`yoqa assert`) | Runner + connected device |
| Test management (apps/cases/flows) | Runner only |
| Run saved cases | Runner + device + AI provider |

Cloud sign-in and credits are not required for local workflows.

## Conventions

- Pass `--json` whenever you intend to parse output — the human-readable formats are terse and change.
- All screen coordinates are relative `0–1000` on both axes, `0,0` at the top-left. Read them off a
  `yoqa screenshot` and aim at the centre of the control.
- Look at a screenshot first. `yoqa screen` is the fallback (exact ids and labels), and it cannot see
  system sheets.
- Add `--screenshot` to an action to get the result screenshot in the same call (it waits for the
  screen to settle, and a second image marks where the tap landed). Always use it on games.
- `--duration` on an action is in **milliseconds**; `--timeout` on `assert` / `runs wait` is in **seconds**.

See [Environment, Diagnostics & Conventions](references/environment.md).

## Workflows

### 1. Debug on device

You drive the device: take a screenshot, act, then verify. **Look at the screenshot and act by `--x` /
`--y`** ([Actions by coordinates](references/actions-coordinates.md)) — it works on every control,
including custom-drawn UI, games, and system sheets, and it is the only way to swipe and drag. Fall back
to `--id` or `--label` read off `yoqa screen --json` when you know the identifier or coordinates keep
missing ([Targeting elements](references/actions-grounding.md)), then to `--description` grounding.
Requires a connected device; install a build and launch by app id only if the app isn't already
running.

- Workflow: [Debug directly on device](workflows/debug-on-device.md)

### 2. Test Management

Create and edit test cases, reusable flows, tags, and the app context. Does not run anything on a device.

- Workflow: [Create & update test cases](workflows/test-cases.md)
- Concepts: [Test Cases, Flows & App Context](concepts/test-cases.md) · [Writing Good Test Cases](concepts/writing-test-cases.md)

### 3. Run saved test cases

Run already-saved cases by number on the connected device — for smoke/regression. Requires a configured
AI provider.

- Workflow: [Run saved tests with the Yoqa agent](workflows/run-tests.md)

### 4. Run tests in cloud

Not implemented yet — in development.

## Reference index

| File | Covers |
|---|---|
| [Environment](references/environment.md) | `health`, `status`, `serve`, `doctor`, `runtime`, `setup`, `servers`, global flags |
| [Devices](references/devices.md) | list, connect, active, disconnect |
| [Inspect & App Control](references/inspect-and-app-control.md) | `screenshot` (first), `screen` (fallback), app lifecycle, alerts |
| [Actions by coordinates](references/actions-coordinates.md) | tap/input by point read off a screenshot; swipe and drag |
| [Targeting elements](references/actions-grounding.md) | `--id`, `--label`, `--description` for tap/input (fallback) |
| [Assertions](references/assertions.md) | `yoqa assert visible` / `not-visible` |
| [Apps, Cases & Flows](references/apps-cases-and-flows.md) | the whole catalog surface |
| [Builds](references/builds.md) | the build registry |
| [Run Tests](references/run.md) | `runs create/get/wait/report` |

## Rules

- **If a command fails because the device or session is unhealthy** ("not reachable", "no active session",
  a wedged connect):
  1. `yoqa doctor --fix` — applies the safe repairs and re-reports
  2. `yoqa status` to confirm what's still wrong
  3. `yoqa runtime ensure` if the Appium runtime or drivers are missing
  4. If a session is still stuck: `yoqa devices disconnect`, then reconnect
  5. Do not invent other start commands; if it still fails, ask the user to start the runner/desktop
     (`yoqa serve`, or `bun run desktop` from this repo)
- **If a tap changes nothing or an element isn't found**, take a fresh `yoqa screenshot` and adjust the
  point or pick a different target — never retry the same point or selector twice. Check for a system
  sheet or dialog covering the app first. After two misses, read `yoqa screen --json` for an `--id` or
  `--label`.
- **If grounding or agent runs fail because no provider is configured**, tell the user to open
  Settings → Provider in the Yoqa app. For debugging, switch to coordinates (or `--id` / `--label`) instead
  of waiting on it.
- **Confirm before any write or delete** in the catalog (`apps update`, `cases create/update/delete`,
  `flows update/delete`, `builds delete`, `runs delete`) — show exactly what you intend to send.
- If you need more information about Yoqa that isn't covered in this skill, refer to the documentation at
  https://yoqa.arisn.dev/llms.txt
