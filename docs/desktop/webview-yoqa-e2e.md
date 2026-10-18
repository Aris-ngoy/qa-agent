# Desktop webview e2e, driven by Yoqa

## Goal

Have Yoqa test its own desktop app: run the desktop webview in CI and drive it with the `yoqa` CLI on the web Direct lane, the way a user would test their own web app. The Playwright job ([webview-e2e.md](./webview-e2e.md)) checks the webview from the inside (console messages, network requests). This job checks it the way Yoqa sees any page (the accessibility tree, label taps, asserts, a report with a screenshot per step), so a break in either the webview or the web lane shows up. Vocabulary: **Run**, **Case Script**, **Browser device**, **Viewport preset** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **The same harness as the Playwright job.** `e2e/start-runner.ts` seeds a throwaway runner on port 4791 (one app, one test case, one finished web Run), and `vite.e2e.config.ts` serves the webview on 5191 with `@/app/desktop-rpc` stubbed. Rejected: driving the packaged Electrobun app, which uses the system webview (`bundleCEF: false`) and so has no Chromium debug port, needs a macOS runner and a build, and has no driver in Yoqa today.
- **Two runners.** The webview talks to the seeded runner. A second runner (`yoqa serve` on 7420) drives the browser and keeps its own catalog, so the Run that does the testing never shows up in the app under test.
- **Attach by port at the desktop preset.** The job starts the runner image's Google Chrome headless with a debug port and connects `chromium-cdp-9222` at `desktop` (1280×800), the size the desktop window opens at. Same setup as the Expo demo's web job ([expo-demo-web-e2e.md](../devices/expo-demo-web-e2e.md)).
- **Checked-in CaseScripts, script mode.** Each case opens the webview's URL first, so it doesn't depend on where the previous case left the page. No AI provider is involved.
- Tap labels are exact where the substring fallback would pick a smaller element: "Checkout happy path" alone matches the row's "Select Checkout happy path" checkbox, so the case taps "Checkout happy path Case #1".

## What shipped

- `apps/desktop/e2e/yoqa/`:
  - `open-case-and-run.yoqa.yaml`: open the seeded test case (its editor shows), go to Runs, open the seeded Run, and check that the top bar says "Run details" and "chromium (Web)".
  - `create-case.yoqa.yaml`: create a test case, replace its default name with "Login works" (End, then Shift+Home to select the name), save it, and find it in the list.
  - `ci-yoqa.sh`: starts the seeded runner, Vite and headless Chrome, waits for each, connects, seeds an App `DESK` whose Web URL is the webview plus one case per CaseScript, runs both with `--github-output`, and saves `desktop-final.png`. On exit it stops the harness and browser, waits for Chrome to release its profile before deleting it, and keeps the Run's exit status.
- `.github/workflows/desktop-e2e.yml`: a **Desktop webview (Yoqa)** job next to the Playwright one. It uploads `yoqa-desktop-webview-report` through `./.github/actions/yoqa-report`, `yoqa-desktop-webview-screenshots` and, on failure, `yoqa-desktop-webview-failure` (both runners', Vite's and Chrome's logs). `packages/cli/**` joins the workflow's path filter.

## How to verify

```bash
bun run --filter @yoqa/runner build && bun run --filter @yoqa/cli build
yoqa serve &                                   # the driving runner, on 7420
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bash apps/desktop/e2e/yoqa/ci-yoqa.sh
yoqa report --latest -o /tmp/desktop.html      # 2 cases, a screenshot per step
```

Ports 4791, 5191 and 9222 must be free (`YOQA_DESKTOP_CDP_PORT` moves the last one). Run against Chrome for Testing 156 on macOS before the PR: both cases passed, and nothing was left listening afterwards.

## Follow-ups

- More flows on the same harness: Settings sections, the App editor's Web URL, the device picker once the stub can list devices.
- The packaged app stays untested end to end. It would need a CEF build with a debug port, or a macOS accessibility driver.
