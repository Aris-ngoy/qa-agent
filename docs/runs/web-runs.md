# Web: Web URL on the App, and Runs on web

## Goal

A Test Case runs end to end on web ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). Until now a web device could be driven Action by Action, but a Run had nothing to open: an App named only an iOS bundle id and an Android application id. This slice gives the App a **Web URL**, and makes `yoqa runs create` on a web device open it before the first case, the way a mobile Run targets its bundle. Ticket [#309](https://github.com/Aris-ngoy/qa-agent/issues/309). Vocabulary: **Run**, **Lane**, **Browser device**, **Run recording** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **The Web URL is the App's start target on web.** `appStartTarget(app, "web")` returns the trimmed Web URL, as it returns the bundle id on iOS. A Run hands it to the agent as the default app id, so `restart-app`, `activate-app` and `terminate-app` without an `--app-id` act on it ([web-gestures-alerts-lifecycle.md](../devices/web-gestures-alerts-lifecycle.md)).
- **An additive catalog column.** `apps.web_url`, `NOT NULL DEFAULT ''`, added by `migrateAppsWebUrl` like the other additive columns. An old database opens with an empty Web URL on every App. The client schema reads a missing `webUrl` as `""`, so a newer client still parses an older runner.
- **A web-only App needs only a name and a Web URL.** `POST /apps` takes an optional `webUrl`; `PATCH /apps/:id` sets it, and `""` clears it. Anything other than an http or https URL is a 400 that names the Web URL. Rejected: storing any string and failing at Run time, which would leave a typo to surface only mid-Run.
- **The Run opens the page, not the connect.** Connect and retarget requests still name no app on web (`startTargetRequest` is `{}`), so an Inspector connect does not navigate the user's page. `executeRun` opens the Web URL with `openUrl` once the session is acquired, before the first case. Rejected: `activate-app`, which leaves a page already on the App's origin where it is, so a second Run would start wherever the first one ended.
- **Fail fast without a Web URL.** The check runs right after the App is read: before any provider check, build install or connect. The Run errors with `<App> has no Web URL, so a Run on web has nothing to open. Set one with: yoqa apps update <prefix> --web-url <url>`, and the browser is never touched.
- **The report names the browser.** The web lane reports `DeviceSession.browser`: the installed browser's name and version for a Yoqa-owned instance (`Google Chrome 141.0`), and `Browser.getVersion` for an attached one (`Chrome 140.0.0.0`). The Run stores it in a new nullable `runs.browser` column, and the HTML, Markdown and GitHub summary reports gain a Browser row next to Platform and Lane.
- **Recording is "no video", with a reason.** The web lane still has no `startRecording`. It now says why through `DeviceSession.noRecordingReason`: "Run recording is not available on web". The case records that note and the Run carries on.

## What shipped

- **Catalog**: `webUrl` on `catalogAppSchema` (default `""`), `createAppRequestSchema` and `updateAppRequestSchema`; the `web_url` column and its migration; validation on create and update.
- **Runs**: `executeRun` fails a web Run with no Web URL, opens the Web URL before the first case, and saves the session's browser. `Run.browser` is optional and additive.
- **Web lane**: `browser` and `noRecordingReason` on the session. `cdp-client.ts` types `Browser.getVersion`, and the fake CDP endpoint answers it.
- **Reports**: `RunReportDocument.browser`, from the Run, shown as a Browser row in every format.
- **CLI**: `yoqa apps create --web-url <url>` (one request, so `--name` and `--web-url` make a web-only App), `yoqa apps update APP --web-url <url>`, and `web_url:` in `yoqa apps get`. `yoqa runs create --device web-chrome` (or `chromium-cdp-<port>`) infers `--platform web`, as `devices connect` does, so it needs no Active Session. The skill's apps reference lists the new flags.
- **Desktop**: a Web section with a Web URL field in the App editor, checked as http(s) before save.
- **Tests**: `catalog/web-url.test.ts` (round-trip through the application and HTTP API, an old database, refused URLs), `runs/web-run.test.ts` (whole Runs against a faked CDP endpoint: the page opens on the Web URL and script cases tap it; platform, browser and Lane on the Run; recording is "no video" and the Run passes; a missing Web URL errors before connecting), an agent case on web acting on the Web URL in `case-executor.test.ts`, the browser name in `web-direct-lane.test.ts`, the Browser row in `run-report.test.ts`, and the CLI in `cli/src/app-web-url.test.ts` and `cli/src/runs-create-web.test.ts`.

## How to verify

```bash
bun test services/runner/src/domains/catalog/web-url.test.ts services/runner/src/domains/runs/web-run.test.ts
bun test packages/cli/src/app-web-url.test.ts packages/runner-client/src/run-report.test.ts
bun run lint:ci && bun run test && bun run check
```

Manual check, on a Mac with Chrome installed:

1. **Expo web build.** In an Expo app, run `npx expo start --web` (it serves on `http://localhost:8081`). Point an existing App at it with `yoqa apps update APP --web-url http://localhost:8081`, or in the desktop App editor's Web URL field. Create a case such as "Tap the first button, then check its screen opens". Run `yoqa runs create APP --cases 1 --device web-chrome --wait`. Chrome opens on a fresh profile at the Web URL, the agent works from screenshots, and the Run passes. `yoqa report --latest` shows Platform `web`, Browser `Google Chrome <version>` and Lane `direct`.
2. **Small SPA.** Serve any SPA (for example `npx serve dist` on `http://localhost:3000`). Create a web-only App with `yoqa apps create --name "SPA" --web-url http://localhost:3000`, add a case, and run it on `web-chrome` as above. Run it again after it has saved a Case Script: the script replays on the page, which starts at the Web URL each time.
3. **Missing Web URL.** Run a case of an App with no Web URL on `web-chrome`. The Run errors at once with "has no Web URL … yoqa apps update … --web-url <url>", and no browser opens.
4. **Recording.** Run with `--record-video`: the Run passes, and the case's recording reads "no video: Run recording is not available on web".

## Follow-ups

- The viewport preset on the Run and in the report: [#310](https://github.com/Aris-ngoy/qa-agent/issues/310).
- Web devices in the desktop device picker and Runs panel: [#311](https://github.com/Aris-ngoy/qa-agent/issues/311). The App editor field is here already.
- The rest of the skill and public docs for web: [#312](https://github.com/Aris-ngoy/qa-agent/issues/312).
- Run recording on web (a CDP screencast) stays out of scope for #301.
