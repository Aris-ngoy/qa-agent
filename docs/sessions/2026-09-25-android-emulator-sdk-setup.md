# Android Emulator CI: the `tools` package and a job that was never green

## Goal

Fix the one red job on the last few runs — `Demo Expo E2E / Android Emulator`, failing in
`Setup Android SDK` — and correct the docs, which described the Android job as working config.

## Plan summary

The framing going in was "infrastructure, and not one of the three required checks, so it's low
priority." Log investigation did not support that framing, which changed the plan:

- **It was our bug, not infrastructure.** `android-actions/setup-android@v4.0.1` was called with
  no `with:`, so it used its own default `packages: 'tools platform-tools'`. Google retired the
  legacy `tools` package, so `sdkmanager tools` prints `Warning: Failed to find package 'tools'`
  and exits 1, hard-failing the step. Upstream [#537](https://github.com/android-actions/setup-android/issues/537).
- **The job had never passed.** 48 consecutive runs checked (2026-09-19 → 2026-09-25), all
  `failure`. `iOS Simulator` green in 10 of the last 12 — so Android-specific, not general rot.
- **Two failures were stacked.** The setup failure was masking a second one further down.

Rejected: driving the job fully green in this pass (it is very likely Yoqa product bugs, not CI —
a multi-session job). Retiring or gating off the Android job. Touching the emulator config.
Writing an ADR (none of hard-to-reverse / surprising / real-trade-off hold).

## What shipped

- `.github/workflows/demo-expo-e2e.yml` — `Setup Android SDK` now passes `packages: platform-tools`
  explicitly, overriding the broken default. `android-emulator-runner` installs the emulator and
  system image itself, so `platform-tools` (for `adb`) is all the step owes the rest of the job.
- A job-level comment recording that the job is unproven, and that green proves the SDK step only.
- `docs/cli/github-actions-expo.md` — corrected status, the shipped config change, and Follow-ups
  reordered so "get Android green" precedes "make it a required check".
- [#147](https://github.com/Aris-ngoy/qa-agent/issues/147) — the real Android debugging, tracked.

### The run history that justified the above

Read from the GitHub Actions API (`/actions/runs/<id>/jobs`), not from memory:

| Window | `Android Emulator` | Failing step |
| --- | --- | --- |
| 2026-09-19 → 2026-09-24 ~04:00 | failure | `Setup Android SDK` |
| 2026-09-24 ~04:00–05:00 (6 runs) | failure | `Build, install, and smoke on emulator` |
| 2026-09-24 05:00 → 2026-09-25 | failure | `Setup Android SDK` |

The middle window is the important one: those runs got *past* setup and failed at the smoke step
with

```
run run_46176d7b-0e35-4d14-966c-73d491360e68 errored
yoqa screenshot failed: Failed to take screenshot: [Tool:screenshot]
  Service dependency failed: [SimulatorServer:emulator-5554]
  simulator-server exited with code before becoming ready
```

Emulator booted, APK installed, `yoqa devices connect` succeeded, run created — then it died
inside the **Yoqa runner**. That is product code, not workflow config.

Caveat worth keeping: that log came from PR #135's revision, which used `@swmansion/argent`. The
current `ci-android.sh` (yoqa CLI + Appium) has never completed a run in CI. Treat the Argent log
as a lead, not a diagnosis.

## How to verify

1. `bun run lint:ci` and `bun run check` — Biome 1.9.4 does not lint YAML, so this change has no
   automated coverage. Parsing the workflow and a live run are the only real checks.
2. `gh workflow run demo-expo-e2e.yml -f platform=android`, then confirm `Setup Android SDK` passes.
3. Treat that as necessary, not sufficient — see [#147](https://github.com/Aris-ngoy/qa-agent/issues/147).

## Follow-ups

- The `ci-android.sh` smoke path on emulator is unproven and is the real remaining work (#147).
- `bun test` has a pre-existing environment-coupled failure:
  `listOpenCodeModelsFromCli > lists models when opencode is installed` asserts that
  `deepseek-v4-flash-free` is in the locally-installed `opencode` CLI's catalog. It fails on any
  machine whose opencode catalog differs. It sits in the **required** `Unit tests` check, so it can
  redden a required check for reasons unrelated to the change under test.
- `docs/agents/triage-labels.md` lists a `ready-for-human` label the repo has never created, so
  `gh issue create --label ready-for-human` fails. Either create the label or drop the row.
