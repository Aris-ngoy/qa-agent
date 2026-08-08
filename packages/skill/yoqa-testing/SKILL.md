---
name: yoqa-testing
description: Use this skill when the user wants to boot and interact with iOS or Android devices/simulators — inspect the screen, execute actions, run UI tests, or manage test cases via the Yoqa platform.
---

# Yoqa Device Testing

Yoqa controls iOS/Android devices and simulators through the `yoqa` CLI. There are two modes of interaction: you drive the device yourself (debug), or the Yoqa agent runs saved test cases for you.

Pick one workflow below by what the user wants. Follow that workflow's file — it links to the exact commands in `references/`.

## Before you start

1. Ensure the local runner is up (`bun run runner` or via the Yoqa desktop app). Confirm with `yoqa health`.
2. Check local readiness with `yoqa status` — it reports runner, Appium runtime, AI provider, and active device (no cloud account required for local use).
3. **Find the app & its prefix** — run `yoqa apps list` and note the `PREFIX`. Most catalog commands take the prefix as the first argument. See [Apps, Cases & Flows](references/apps-cases-and-flows.md).
4. For **description grounding** (`-d` / `--description`) and **agent runs**, configure an AI provider in Settings → Provider (`yoqa status` should show a configured provider).

| Need | Requirement |
|---|---|
| Debug on device (coords) | Runner + connected device |
| Debug with `-d` grounding | Runner + connected device + AI provider |
| Test management (apps/cases/flows) | Runner only |
| Run saved cases | Runner + device + AI provider |

Cloud sign-in / credits are not required for local workflows yet.

## Workflows

### 1. Debug on device

You drive the device: inspect the screen, then tap/swipe/drag/type via `yoqa action`. **Prefer describing the target element in plain language with `--description`** when a provider is configured; see [Actions by description](references/actions-grounding.md). As a fallback, pass explicit relative coordinates — [Actions by coordinates](references/actions-coordinates.md). Requires a connected device; install a build and launch by bundle ID only if the app isn't already running.

- Workflow: [Debug directly on device](workflows/debug-on-device.md)

### 2. Test Management

Create and edit test cases, reusable flows, tags, and the app context. Does not run anything on a device.

- Workflow: [Create & update test cases](workflows/test-cases.md)
- Concepts: [Test Cases, Flows & App Context](concepts/test-cases.md) · [Writing Good Test Cases](concepts/writing-test-cases.md)

### 3. Run saved test cases

Run already-saved cases by number on the connected device — for smoke/regression. Requires a configured AI provider.

- Workflow: [Run saved tests with the Yoqa agent](workflows/run-tests.md)

### 4. Run tests in cloud

Not implemented yet — in development.

## Rules

- If any command reports that Yoqa / the runner is not running / not reachable / "start it first":
  1. Ensure the local runner is up: `bun run runner` (from the repo root)
  2. Confirm with `yoqa health` (or `bun run health`)
  3. If the desktop UI is needed: `bun run desktop`
  4. Do not invent other start commands; if it still fails, ask the user to start the runner/desktop
- If grounding or runs fail because no provider is configured, tell the user to open Settings → Provider in the Yoqa app
- If you need more information about Yoqa that isn't covered in this skill, refer to the documentation at https://docs.yoqa.ai/llms.txt
