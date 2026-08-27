# Run Tests

Starts a test run with the Yoqa agent on the active device. Requires a configured AI provider
(`yoqa status` shows `provider: …`).

Case numbers go in the **required `--cases` flag** as a comma-separated list — not as positional
arguments. The app prefix is the positional argument.

```bash
yoqa runs create APP --cases 1,2,5                              # use the app already on the device
yoqa runs create APP --cases 1,2,5 --build-id <build-id>        # install a registered build first
yoqa runs create APP --cases 1,2,5 --build-path /abs/path/App.ipa
yoqa runs create APP --cases 1 --wait                           # block until the run finishes
yoqa runs create APP --cases 1 --wait --timeout 3600            # wait timeout in seconds (default 1800)
```

```bash
yoqa runs list APP                          # recent runs: id, status, platform, device
yoqa runs get <run-id>                      # run status + per-test pass/fail (no app argument)
yoqa runs get <run-id> --json               # full detail: flows, expected results, steps
yoqa runs wait <run-id>                     # block until an already-started run finishes
yoqa runs wait <run-id> --timeout 3600
yoqa runs delete <run-id>                   # delete a run and its results (irreversible)
```

> **`runs delete` is destructive and irreversible — always get explicit user approval first.** Name the
> exact run (id) you intend to delete and wait for confirmation before running. Never delete a run the
> user didn't ask you to remove.

## Notes

- Saved cases are referenced by their **number** (from `yoqa cases list APP`), not `PREFIX-N`
- All case numbers must belong to the app whose prefix you pass
- The active device is used automatically — connect one first with
  `yoqa devices connect <id> --platform <ios|android>`. Override with `--device <id>` and
  `--platform <ios|android>` (pass both).
- **A build is optional.** Omit both build flags when the app is already installed (e.g. a React Native
  debug build launched via Metro). Note that without a build there is **no clean reinstall** — the app
  keeps whatever state is on the device (login, onboarding, leftover data), which bleeds across cases.
  Fine for a quick check; for a regression suite pass a build so each run starts clean. Otherwise pass
  **one** of:
  - `--build-id <build-id>` — a build already registered with `yoqa builds create`. See [Builds](builds.md).
  - `--build-path <abs-path>` — an **absolute** path to a `.ipa`/`.app`/`.apk` (e.g. `/Users/me/build/App.ipa`,
    not `build/App.ipa`); parsed on the fly for version, bundle ID, and platform.
- `--build-id` and `--build-path` are mutually exclusive
- Supported build formats: `.ipa` (iOS device), `.app` (iOS simulator), `.apk` (Android)
- `runs create` returns a `run_id`. Prefer `--wait` over polling; `--wait` exits non-zero if the run errored.
- Optional `--mode auto|script|agent` — prefer a saved script, force AI, or auto (default)
- In CI, `--github-output` writes `run_id` and `status` to `$GITHUB_OUTPUT`

## Reports

```bash
yoqa runs report <run-id>                          # self-contained HTML (default)
yoqa runs report <run-id> --format md -o ./report.md
yoqa report --latest APP                           # newest run for an app
yoqa report <run-id> --wait                        # wait for the run, then export
```

Both spellings work (`yoqa report` and `yoqa runs report`). The export embeds step details and
screenshots. `--fail-on errored` makes the command exit non-zero for a failed run; `--github-summary`
appends a compact summary to `$GITHUB_STEP_SUMMARY`.

## Exported scripts (no agent)

After a successful agent run, the desktop app can export a CaseScript JSON file. Replay it without
calling the model:

```bash
yoqa devices connect <device-id> --platform ios
yoqa script run ./login.yoqa.json
```

A CaseScript replays taps (by `--label`/`--id`/coordinates), text input, waits, and assertions.
