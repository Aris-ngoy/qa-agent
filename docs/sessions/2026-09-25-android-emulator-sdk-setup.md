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

## Run outcome: fix confirmed, then a flake, then green

Two runs carried the `packages: platform-tools` fix, and they disagree. Both results matter.

**[Run 36171085459](https://github.com/Aris-ngoy/qa-agent/actions/runs/36171085459)** (PR #148) was the
first to get past `Setup Android SDK`, and the first to run `ci-android.sh` end to end on the
current yoqa-CLI + Appium stack. It failed. The report's actual error, absent from the job log, was:

```
Saved script replay failed
Expected visible text not found within 60s: Yoqa Demo
```

That is `smoke.yoqa.json:6-11`, the *first* of eight actions. `android-screen.json` from that moment
is dominated by `alertTitle` = "Pixel Launcher isn't responding". The app itself was fine — the
failure-handling dump showed `text="Yoqa Demo"`, `text="Count: 0"` and all three buttons.

`ci-android.sh:61-83` does dismiss ANR dialogs, but that loop ends *before* `yoqa devices connect`
(line 85) and `yoqa runs create` (line 87). An ANR appearing once the run is underway is never
dismissed, and `smoke.yoqa.json` has no dialog handling. Plausible cause is emulator resource
starvation (`ram-size: 4096`, `heap-size: 512`, `-gpu swiftshader_indirect`, `-no-window`).

**[Run 36200906689](https://github.com/Aris-ngoy/qa-agent/actions/runs/36200906689)** (main, after
merge) then passed outright: `Android Emulator` ✅ and `iOS Simulator` ✅ — the first time the
workflow has been fully green. The Android report reads `#1 Smoke (Passed)`, 10.6s, with all 8
actions passing individually (assert `Yoqa Demo` 451ms, tap `Increment` 458ms, …).

### What that combination actually means

The ANR was a **flake, not a broken path**. Actions 2–8 have now executed in CI and all pass, so the
counter, greeting, and typing assertions are validated for the first time.

It also means the iOS failure on run 36171085459 was a flake too — iOS passed on the next run.

So the honest scoreboard, on a sample of two:

| Platform | Post-fix runs | Green |
| --- | --- | --- |
| Android | 2 | 1 |
| iOS | 2 | 1 |

The fix removed a hard, deterministic blocker. What remains is flakiness, and n=2 at ~50% is not
enough to call either job reliable. **Do not read the first green as the job being fixed** — read it
as the blocker being removed and the noise floor being unmapped.

A lesson worth keeping, since this document got it wrong first: the earlier draft of this note
asserted the smoke path "had never completed" and that the ANR was a diagnosed root cause. Both were
true when written and false a day later. `AGENTS.md` wants run telemetry in a session note precisely
so that area docs and workflow comments can stay durable — but the corollary is that anything
phrased as a present-tense fact about a flaky pipeline will rot.

### Still-open bug from the failing run

`capture_failure` (`ci-android.sh:27-41`) runs `adb shell uiautomator dump`, which crashes with
`IllegalStateException: UiAutomationService … already registered!` — only one UiAutomationService can
be registered, and Appium's UiAutomator2 driver holds it. It lands 114ms *after* the run errored, so
it is a consequence and not a cause, but it means any future Android failure will be as unreadable
as this one was. Disconnect before dumping, or source the dump from Appium's own endpoint.

## How to verify

1. `bun run lint:ci` and `bun run check` — Biome 1.9.4 does not lint YAML, so this change has no
   automated coverage. Parsing the workflow and a live run are the only real checks.
2. `gh workflow run demo-expo-e2e.yml -f platform=android`, then confirm `Setup Android SDK` passes
   and the run summary says `#1 Smoke (Passed)`.
3. Read smoke results from the run's **Artifacts** (`yoqa-expo-demo-*-report`), not the job log. The
   log only says `errored`; the report carries the per-action error and timing.
4. Two runs is not a flake rate. Before trusting this workflow, sample more than two.

## Follow-ups

- Map the flake rate before anyone calls this workflow reliable or makes it required. Two data points
  at 1-of-2 green is a starting measurement, not a baseline.
- Android ANR handling during a run (#147) — dismiss dialogs after connect, or fix the starvation.
- Android failure diagnostics are broken while a session is live (#147) — the next red run will be
  unreadable without fixing this first.
- iOS connect timeouts (#149) — 124s simulator boot, then two `POST /session` timeouts ~6.5 min apart.
- `bun test` has a pre-existing environment-coupled failure:
  `listOpenCodeModelsFromCli > lists models when opencode is installed` asserts that
  `deepseek-v4-flash-free` is in the locally-installed `opencode` CLI's catalog. It fails on any
  machine whose opencode catalog differs, and passes on a GitHub runner, which has no such CLI. It
  sits in the **required** `Unit tests` check, so it can redden a required check for reasons
  unrelated to the change under test.
- `docs/agents/triage-labels.md` lists a `ready-for-human` label the repo has never created, so
  `gh issue create --label ready-for-human` fails. Either create the label or drop the row.
