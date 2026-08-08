# Run Tests

Starts a test run with the YoQA agent on the active device. Requires a paid account with credits.

The first argument is always the **app prefix**, followed by the cases to run — either saved case numbers or an inline JSON array of ad-hoc cases.

```bash
yoqa runs create APP 1 2 5 --build-id <build-id>               # run saved cases against a build from the registry
yoqa runs create APP 1 2 5 --build-path /path/to/app.ipa        # run saved cases, install a build from an absolute path
yoqa runs create APP 1 2 5                                      # run saved cases using the app already on the device
yoqa runs create APP 1,2,5                                      # case numbers may also be comma-separated
yoqa runs create APP '[{"name": "Login", "flows": [{"instructions": "tap login", "result": "home screen shows"}]}]'  # run ad-hoc cases directly from flows, no saved case needed
yoqa runs list APP                                              # list recent runs (ID, STATUS, TESTS, SOURCE, CREATED)
yoqa runs get APP <run-id>                                      # show all tests in a run with pass/fail and check counts
yoqa runs get APP <run-id> <test-id>                            # show test details: flows, expected results, steps
yoqa runs report <run-id>                                       # export HTML report with screenshots (default)
yoqa runs report <run-id> --format md -o ./report.md             # export Markdown report to a path
yoqa runs delete APP <run-id>                                   # delete a run and its results (irreversible)
```

> **`runs delete` is destructive and irreversible — always get explicit user approval first.** Name the exact run (id) you intend to delete and wait for confirmation before running. Never delete a run the user didn't ask you to remove.

- Saved cases are referenced by their **number** (the ID column from `yoqa cases list APP`), not `PREFIX-N`
- Ad-hoc cases are a JSON array; each case is `{"name", "flows": [{"instructions", "result"?}]}` — `name` is required
- **Build is optional** — omit both build flags when the app is already installed on the device (e.g. React Native debug build launched via Metro / `npx react-native run-ios`). Note: omitting the build means **no clean reinstall** — the app keeps whatever state is already on the device (login, onboarding, leftover data), which bleeds across cases. Fine for a quick check; for a regression suite pass a build so each run starts clean. Otherwise pass **one** of:
  - `--build-id <build-id>` — reference a build already registered with `yoqa builds create`. See [Builds](builds.md).
  - `--build-path <abs-path>` — an **absolute path** to a `.ipa`/`.app`/`.apk` (e.g. `/Users/me/build/App.ipa`, not `build/App.ipa`); parsed on the fly for version, bundle ID, and platform.
- `--build-id` and `--build-path` are mutually exclusive
- The active device is picked up automatically — connect one first with `yoqa devices connect <id>`
- Returns a `run_id`; inspect results (pass/fail, screenshots) with `yoqa runs get APP <run-id>`
- Optional `--mode auto|script|agent` — prefer a saved script, force AI, or auto (default)
- **`runs report`** exports a self-contained HTML or Markdown file with step details and embedded screenshots. Run must be finished (`passed` / `errored` / `cancelled`). Default output: `yoqa-run-<id>-<status>.html`.

## Exported scripts (no agent)

After a successful agent run, the desktop app can export a CaseScript JSON file. Replay it without calling the model:

```bash
yoqa devices connect <device-id>
yoqa script run ./login.yoqa.json
```

Shell exports (`.sh`) call `yoqa action tap|input` and `sleep` instead — useful for copy/paste debugging.
