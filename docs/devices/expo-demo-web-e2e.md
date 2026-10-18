# Demo Expo E2E: a web job

## Goal

Run the Expo demo's smoke on web in CI, next to the iOS Simulator and Android Emulator jobs in **Demo Expo E2E**, so a change to the web Direct lane, the CLI or the runner is checked against a real browser and a real React Native Web build, not only the faked CDP endpoint in the Lane contract suite. Background: [web-attach-by-port.md](./web-attach-by-port.md), [web-viewport-presets.md](./web-viewport-presets.md), [web-runs.md](../runs/web-runs.md), the mobile jobs in [github-actions-expo.md](../cli/github-actions-expo.md). Vocabulary: **Browser device**, **Viewport preset**, **Web URL** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **A static export, not the dev server.** `npx expo export --platform web` builds `examples/expo-demo/dist` in seconds, and `python3 -m http.server` serves it. Rejected: `expo start --web`, which adds Metro, a watcher and a first-request bundle to wait on, and tests a dev build no one ships.
- **Attach by port on Ubuntu.** Installed-browser discovery (`web-chrome`) is macOS only, so the job starts the runner image's Google Chrome itself (`--headless=new`, a temporary `--user-data-dir`, `--remote-debugging-port=9222`) and connects `chromium-cdp-9222`. Rejected: a macOS runner for `web-chrome`, which costs more and waits longer for a slot, and tests launching rather than the lane.
- **The mobile Viewport preset.** The demo is a phone app, so the job connects at `--viewport mobile` (390×844, touch): taps are touch taps and the layout matches the phone jobs.
- **Same CaseScript, same seed.** `seed-catalog.sh` sets the App's Web URL when `YOQA_DEMO_WEB_URL` is set, and the job runs `yoqa runs create DEMO --cases 1 --mode script`, which opens the Web URL before the case, as the other jobs launch the app.
- **Screenshots from the connector smoke.** After the Run, the script reopens the Web URL and runs `ci-smoke.sh`, which saves a PNG after every action into `artifacts/screenshots`. Running both still exits non-zero if either fails, and on failure saves `web-failure.png` and the Screen JSON.
- **The demo gains `react-dom` and `react-native-web`**, which Expo web needs. This changes `package.json`, so the iOS and Android cache keys miss once and rebuild their binaries.
- **`platform: both` becomes `all`**, with a new `web` choice. Only a manual dispatch reads it.

## What shipped

- `examples/expo-demo/yoqa/ci-web.sh`: serves the export, starts headless Chrome (`CHROME_BIN` overrides the browser, `YOQA_DEMO_WEB_PORT` / `YOQA_DEMO_CDP_PORT` the ports), waits for both, connects, seeds, runs the catalog Run with `--github-output`, then the connector smoke. On exit it stops the server and browser, waits until no process has the profile open (Chrome keeps writing it while it shuts down; the first CI run failed on `rm` after a passing smoke), deletes it, and keeps the smoke's exit status.
- `seed-catalog.sh`: `--web-url` on create and update when `YOQA_DEMO_WEB_URL` is set.
- `.github/workflows/demo-expo-e2e.yml`: a **Web (Chromium)** job on `ubuntu-latest` (30 min timeout) that builds the runner and CLI, exports the demo, starts `yoqa serve`, runs `ci-web.sh`, and uploads `yoqa-expo-demo-web-report` (through `./.github/actions/yoqa-report`), `yoqa-expo-demo-web-screenshots` and, on failure, `yoqa-expo-demo-web-failure` (runner, Chrome and server logs).
- `examples/expo-demo`: `react-dom` and `react-native-web`, and a Web section in its README.

## How to verify

Locally, with any Chrome or Chrome for Testing:

```bash
bun run --filter @yoqa/runner build && bun run --filter @yoqa/cli build
(cd examples/expo-demo && npm ci && npx expo export --platform web)
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bash examples/expo-demo/yoqa/ci-web.sh
```

It prints `connected web chromium-cdp-9222 lane direct viewport mobile (390×844)`, `run … passed`, and `yoqa expo-demo smoke passed (8 screenshots in artifacts/screenshots)`. `08-hello-ada.png` shows the Greeting screen with "Hello, Ada". Run against Chrome for Testing 151 on macOS before the PR: the Run passed in all 9 steps, and the report's Browser and Viewport rows were filled.

In CI: the **Web (Chromium)** job on a PR that touches a path in the workflow's filter, or Actions → **Demo Expo E2E** → Run workflow with `platform: web`. Download `yoqa-expo-demo-web-report` and `yoqa-expo-demo-web-screenshots` from the run's Artifacts.

## Follow-ups

- Make the web job a required check once it has a run history; unlike the mobile jobs it has no emulator to flake on.
- A `desktop` preset pass, if the demo grows a layout that differs by width.
