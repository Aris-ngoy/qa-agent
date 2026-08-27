# Workflow: Run Saved Tests with the Yoqa Agent

Runs **already-saved** test cases autonomously on a connected device using the Yoqa agent. Requires a
configured AI provider (`yoqa status` shows `provider: …`).

> Developing a new scenario? Drive it on the device first and iterate before saving the case — see
> [Debug directly on device](debug-on-device.md).

> References: [Devices](../references/devices.md) · [Run Tests](../references/run.md) ·
> [Builds](../references/builds.md) · [iOS Native Builds](../references/builds-ios-native.md) ·
> [React Native Builds](../references/builds-react-native.md) ·
> [Android Builds](../references/builds-android.md)

## Steps

### 1. Connect a device

List available devices and connect one (`--platform` is required). See
[Devices](../references/devices.md).

### 2. Provide a build

**Always run saved cases with a build.** Each run reinstalls the app from the build, which keeps a
regression suite consistent — never rely on whatever happens to be installed on the device (e.g. a React
Native app served via Metro is not reinstalled between runs). Produce a binary if needed —
[iOS Native Builds](../references/builds-ios-native.md),
[React Native Builds](../references/builds-react-native.md), or
[Android Builds](../references/builds-android.md); use a Release build unless the user explicitly wants
Debug.

> **If the user wants to skip the build and run against the app already installed on the device, confirm
> with them first and warn about the consequence.** Without a reinstall the app is not reset — leftover
> login, completed onboarding, and data from previous runs or manual use carry over. Test cases assume a
> [cold launch from a clean state](../concepts/writing-test-cases.md#every-test-starts-from-a-cold-launch),
> so a case can pass or fail for the wrong reason. It is worse with several cases in one run: state from
> one test bleeds into the next. Acceptable only for a quick single-case check; for a regression suite,
> insist on a build. If they still want to reuse the installed app, reset its state first —
> [Install iOS](../references/install-ios.md#clean-install-reset-app-state) ·
> [Install Android](../references/install-android.md#clean-install-reset-app-state).

Pass the build one of two ways:

**Option A — register the build first, then run by ID (recommended):**

```bash
yoqa builds create /abs/path/App.ipa --app APP --name "RC1"
```

Reuse the returned id across runs instead of re-passing a path. See [Builds](../references/builds.md).

**Option B — pass a build file path inline:**

For a one-off, skip the registry and pass `--build-path /abs/path/App.ipa` per
[Run Tests](../references/run.md).

### 3. Run the tests

Case numbers go in the required `--cases` flag:

```bash
yoqa runs create APP --cases 1,2,5 --build-id <build-id> --wait
```

Prefer `--wait` over polling — it blocks until the run finishes and exits non-zero if it errored. Without
`--wait` you get a `run_id` back; tell the user the run has started, share the id, and follow it with
`yoqa runs wait <run-id>` or inspect it with `yoqa runs get <run-id>`.

### 4. Report the result

```bash
yoqa runs get <run-id>                                  # per-test pass/fail
yoqa runs get <run-id> --json                           # flows, expected results, steps
yoqa runs report <run-id> --format md -o ./report.md    # shareable report with screenshots
```

## Notes

- All case numbers must belong to the same app (the prefix you pass)
- A device must be connected before running; `runs get` / `runs wait` / `runs delete` take the run id
  with **no app argument**
- Supported build formats: `.ipa` (iOS device), `.app` (iOS simulator), `.apk` (Android)
- If a run fails to start because no provider is configured, tell the user to open Settings → Provider
  in the Yoqa app
