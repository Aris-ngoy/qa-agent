# Workflow: Run Saved Cases

The Yoqa agent runs **already-saved** cases on a connected device and you report the outcome. A
scenario that is not saved yet goes through [Author test cases](test-cases.md) first.

## 1. Preflight

`yoqa status --json` must show an AI provider, and `yoqa cases list APP` must list every case number
the user asked for.

**Done when** both hold. With no provider, stop and ask the user to set one (Settings → Provider in the
Yoqa app).

## 2. Connect a device

Phone or simulator: `yoqa devices connect <id> --platform <ios|android>`. Web:
`yoqa devices connect web-chrome`. [Devices](../references/devices.md)

## 3. Give the run its app

**Phone or simulator — a build.** Each run reinstalls the app from the build, so every case starts
from a [cold launch](../concepts/writing-test-cases.md#every-test-starts-from-a-cold-launch). Ask the
user for the binary, or produce one — [iOS native](../references/builds-ios-native.md) ·
[React Native](../references/builds-react-native.md) · [Android](../references/builds-android.md) —
as a Release build unless the user wants Debug. Then either register it and reuse its id across runs:

```bash
yoqa builds create /abs/path/App.ipa --app APP --name "RC1"
```

or pass `--build-path /abs/path/App.ipa` for a one-off. [Builds](../references/builds.md)

**Running without a build** uses whatever is installed: login, finished onboarding and data from
earlier runs carry over, and with several cases one case's state bleeds into the next, so a case can
pass or fail for the wrong reason. Tell the user that and get their yes first; it suits a quick
single-case check, and a regression suite gets a build. If they go ahead, reset the app's state before
the run: [iOS](../references/install-ios.md#clean-install-reset-app-state) ·
[Android](../references/install-android.md#clean-install-reset-app-state).

**Web — a Web URL.** There are no builds; the run opens the App's Web URL. Check it is set with
`yoqa apps get APP`, and set it with `yoqa apps update APP --web-url <url>` if not.

## 4. Run

```bash
yoqa runs create APP --cases 1,2,5 --build-id <build-id> --wait      # phone or simulator
yoqa runs create APP --cases 1,2,5 --device web-chrome --wait        # web
```

`--wait` blocks until the run finishes and exits non-zero if it errored. Without it you get a `run_id`:
give the user the id and follow it with `yoqa runs wait <run-id>`. Every flag:
[Run Tests](../references/run.md).

## 5. Report

```bash
yoqa runs get <run-id>                                  # per-case pass/fail
yoqa runs get <run-id> --json                           # flows, expected results, steps
yoqa runs report <run-id> --format md -o ./report.md    # shareable report with screenshots
```

**Done when** every case number you passed to `--cases` appears in your answer as passed or failed,
and each failure names the flow that failed, the expected result it missed, and what the agent saw
instead (from `runs get --json`). Then `yoqa devices disconnect`.
