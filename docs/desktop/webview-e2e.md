# Desktop webview e2e

## Goal

Run the desktop webview end to end in a real browser, against a real runner, so regressions that only show up once the app renders and talks to the runner get caught in CI. The first spec guards the top bar title: it names the open test case and Run from the TanStack cache, never fetches on its own, and logs no "No queryFn" errors (see [architecture/desktop-feature-layout.md](../architecture/desktop-feature-layout.md)).

## Plan summary

- **Playwright on the Vite dev server, not the Electrobun app.** The webview is a plain React app. The only host dependency is `@/app/desktop-rpc`, so `vite.e2e.config.ts` aliases it to `e2e/stub-desktop-rpc.ts`, which points `getRunnerBaseUrl` and `ensureLocalServices` at the e2e runner and fails any other host request by name. Driving the packaged app was rejected: it needs a macOS runner, a build, and a native window.
- **A real runner on a throwaway catalog.** `e2e/start-runner.ts` starts `services/runner` with `YOQA_DB_PATH` in a temp folder, creates one app and test case through the HTTP API, and writes one finished web Run straight to the catalog, because a Run can't start without a device. Mocking the runner's HTTP responses was rejected: the e2e should break when the runner and webview disagree.
- **Outside the required checks.** The Desktop E2E workflow runs on PRs that touch the desktop app, the runner, or the packages they share. It is not one of the three required checks.

## What shipped

- `apps/desktop/e2e/`: `harness.ts` (ports and seed names), `stub-desktop-rpc.ts`, `start-runner.ts`, and `top-bar-title.spec.ts`.
- `apps/desktop/playwright.config.ts` starts both servers. Playwright counts the runner as ready once the seeded Run answers, not as soon as `/health` does. `apps/desktop/vite.e2e.config.ts` serves the webview on port 5191, and the runner listens on 4791.
- `bun run e2e` in `apps/desktop`. The e2e files are typechecked with the app (`apps/desktop/tsconfig.json`).
- `.github/workflows/desktop-e2e.yml`: Ubuntu, Bun and Node 22, Playwright Chromium. The HTML report and traces upload when a run fails.
- Specs:
  - The test case page shows **Test case / Checkout happy path**, the Run page shows **Runs / chromium (Web)**, and no console message mentions "No queryFn". With the old title (before Aris-ngoy/qa-agent#317) this test fails on 92 of them.
  - On the Test Cases and Runs lists, nothing requests `/cases/:id` or `/runs/:id`. The title only reads the cache.

## How to verify

```bash
cd apps/desktop
bunx playwright install chromium
bun run e2e
```

Ports 4791 and 5191 must be free. Add `--headed` or `--ui` to watch the run.

## Follow-ups

- The console also shows `stroke-width`/`stroke-linecap` DOM prop errors, HeroUI `PressResponder` warnings, and an unhandled `AbortError: Transition was skipped`. Once those are fixed, the spec can fail on any console error instead of only "No queryFn".
- More flows can use the same harness: Settings sections, the device picker with a stubbed device list, Run export.
