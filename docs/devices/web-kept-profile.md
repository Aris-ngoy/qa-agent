# Web: a Kept profile per App and browser

## Goal

Never sign in twice. A browser Yoqa launches used to start on a throwaway profile that disconnecting deleted, so every connect and every Run met the app's sign-in screen again. A launched browser now keeps its profile per App and browser across disconnects, reconnects and Runs ([#364](https://github.com/Aris-ngoy/qa-agent/issues/364), the tracer bullet of the decision in [#346](https://github.com/Aris-ngoy/qa-agent/issues/346), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). A user resets a Kept profile from the runner and the CLI to start signed out again ([#365](https://github.com/Aris-ngoy/qa-agent/issues/365)). Vocabulary: **Kept profile**, **Browser device**, **Device Session** in [`CONTEXT.md`](../../CONTEXT.md). Background: [web-installed-browsers.md](./web-installed-browsers.md), [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **One Kept profile per App and browser**, at `~/.yoqa/browser-profiles/<appId>/<browserId>/`, the same `~/.yoqa` root as the catalog. Per App because apps under test often need different accounts; per browser because Chromium profiles are not safe to share across browsers or versions. A connect with no App uses `default`. Rejected: profiles the user names.
- **Disconnect keeps the folder.** The browser is killed as before; only a clean profile is deleted. Stopping the runner (SIGINT or SIGTERM) does the same, so it never leaves a browser holding the Kept profile's lock ([runner-stop-quits-sessions.md](./runner-stop-quits-sessions.md)).
- **A clean profile on request.** `profile: "clean"` is the old `mkdtemp` profile, deleted on disconnect. `kept` is the default.
- **Launch flags are unchanged.** `--use-mock-keychain` and `--password-store=basic` stay, or macOS asks for the keychain on every launch. Trade-off: the profile's cookies are protected by the user's account files, not the keychain.
- **Already open:**
  - a connect to the browser the Active Session already drives (same device, App, profile and Viewport preset) returns that session, with no second launch. A connect that differs in any of those replaces the session, as before;
  - a `SingletonLock` whose `<hostname>-<pid>` names another host or a pid that is gone is stale: it, `SingletonSocket` and `SingletonCookie` are removed and the launch goes ahead;
  - a lock held by a live pid on this host fails the connect with `ProfileInUseError`, naming the folder and the pid.
- **The last browser's `DevToolsActivePort` is deleted before launch**, or the launch would read the old port back from the kept folder and connect to nothing.
- **Reset deletes the folder** ([#365](https://github.com/Aris-ngoy/qa-agent/issues/365)): `DELETE /devices/web/profiles?appId=&browserId=`, next to the other `/devices` routes, and `yoqa devices web reset-profile [--app] [--browser]`. Without a browser it is every browser's profile for the App; without an App, `default`. A whole profile is the unit: signing out of a single site stays inside the browser. Rejected: clearing cookies over CDP, which leaves the rest of the profile behind.
- **Reset is refused while the profile's browser is open**, with a 409 and nothing deleted: when the Active Session drives a launched browser on that Kept profile (disconnect first), or when a live browser holds its `SingletonLock` (the same lock rule as launch). A clean profile, an attached browser, or another App's profile does not block it.
- **The CLI's `--app` takes a prefix or an id.** A prefix the catalog knows becomes its id; anything else is used as given, so a deleted App's profile can still be reset.
- **Runs use their App's Kept profile** ([#367](https://github.com/Aris-ngoy/qa-agent/issues/367)). A web Run connects with its `appId` and `kept`, so it is signed in wherever the Inspector was for that App.
  - A Case Script's top-level `profile: clean`, or the create-run request's `profile` (CLI `--profile kept|clean`), asks for a clean one. The Run's wins over its cases'; with none, one clean case makes the whole Run clean, since one session runs every case. Rejected: a fresh session per clean case, which would relaunch the browser mid-Run.
  - A Run adopts the Active Session only when it is on the Run's App and profile; otherwise the browser reopens on them, at the preset the session was connected at, so a Run started on a `mobile` session still runs at `mobile`.
  - The Run stores the profile it used (`kept` or `clean`) and its report, Markdown, GitHub summary and HTML, shows it next to the Viewport preset. An attached browser (`chromium-cdp-<port>`) runs on whatever profile it was started with; the Run still stores what it asked for.
- **An App id must be one plain folder name** (letters, digits, `.`, `_`, `-`, not `.` or `..`), checked by the connect schema (a 400) and again when the folder is named, so a Kept profile never lands outside its root.

## What shipped

- `chromium-browsers.ts`: `launchChromium(browser, deps, { appId, profile })` launches on `keptProfileDir(browserId, appId)`, made if missing, after clearing a stale lock and the old port file; `stop` deletes only a clean profile, and a failed launch keeps a Kept one. `LaunchDeps` gains `home` and `isProcessAlive` for tests. `ProfileInUseError` for a profile a live browser holds.
- `@yoqa/runner-client`: `browserProfileSchema` (`kept` | `clean`), and `appId` and `profile` on `connectDeviceRequestSchema`.
- `SessionOptions` gains `appId` and `profile` (web only), passed from `POST /devices/connect` through `connectDevice` to the web Direct lane's `launch`. `webDirectDeps` takes a `home` override.
- `active-session.ts`: `connectDevice` returns the Active Session for a connect to the browser it already drives.
- Reset: `resetKeptProfiles({ appId, browserId }, deps)` in `chromium-browsers.ts` checks every folder's lock before it deletes any; `resetKeptProfile` in `active-session.ts` refuses first when the Active Session has the profile open (`SessionBusyError`). The route answers `{ appId, browserIds }`, the browsers that had a profile; `ProfileInUseError` and `SessionBusyError` are 409s, a bad App id or a browser Yoqa does not launch a 400. `createSessionRoutes` takes a `home` for tests.
- `@yoqa/runner-client`: `resetWebProfileRequestSchema`, `resetWebProfileResponseSchema`, `RunnerClient.resetWebProfile`.
- CLI: `yoqa devices web reset-profile`. It reads `--base-url` and `--json` from `devices web`, which parses them wherever they are on the line. The skill's `references/devices.md` and the public `web.mdx`, `cli.mdx` and `device-preparation.mdx` now say the profile is kept, and how to reset it.
- Tests: reset in `chromium-browsers.test.ts` (one browser, every browser, default, missing, live and stale locks, a bad App id); the route in `active-session.test.ts` (deletes the folder, refused with 409 while the session's browser or another browser has it open, leaves the folder); the command and its flags in `packages/cli/src/devices-web-reset-profile.test.ts`.
- Tests: launch, keep, relaunch, clean, stale and live locks in `chromium-browsers.test.ts`; the lane keeping the profile across a disconnect and a Dead Session in `web-direct-lane.test.ts`; the route, the default App, clean, and the second connect in `active-session.test.ts`. Every launch in the tests, including the Lane contract harness, uses a temporary home.
- Runs (#367): `profile` on `caseScriptSchema` (read and written as `profile:` in a Case Script file), on `createRunRequestSchema` and on `runSchema`. The runs table gains `requested_profile` and `profile`. `executeRun` resolves the profile and passes it with the `appId` to `acquireSessionForRun`, which adopts a web session only on that App and profile and otherwise reopens at the session's preset. An agent run that re-records a Case Script keeps its `profile`. The report and the desktop Run detail line show `Profile kept|clean`. `yoqa runs create --profile`.
- Desktop (#366): web connects send the selected App's `appId`, and the picker's Browsers tab has "Reset browser profile" per browser; see [web-devices.md](../desktop/web-devices.md#the-apps-kept-profile-and-its-reset).
- `CONTEXT.md`: **Kept profile**, and **Browser device** says a launched browser uses its App's Kept profile.

## How to verify

```bash
cd services/runner
bun test src/domains/devices/chromium-browsers.test.ts src/domains/devices/web-direct-lane.test.ts src/domains/devices/active-session.test.ts
cd ../../packages/cli && bun test src/devices-web-reset-profile.test.ts
```

By hand on a Mac with Chrome, with the runner up:

```bash
curl -s localhost:<port>/devices/connect -H 'content-type: application/json' \
  -d '{"deviceId":"web-chrome","platform":"web","appId":"<app id>"}'
```

Sign in to a site in the window, `POST /devices/disconnect`, connect again: the site is still signed in, and `~/.yoqa/browser-profiles/<app id>/web-chrome/` is there. With `"profile":"clean"` the window starts signed out and its temp folder is gone after disconnect. Opening the same folder in another Chrome (`--user-data-dir=…`) and connecting fails with an error naming the folder.

Reset: while connected, `yoqa devices web reset-profile --app <app id> --browser web-chrome` fails with a message to disconnect first and the folder stays. After `yoqa devices disconnect` it prints the browser it reset, the folder is gone, and the next connect starts signed out.

Runs:

```bash
bun test services/runner/src/domains/runs/web-run.test.ts packages/runner-client/src/run-report.test.ts packages/runner-client/src/case-script-file.test.ts
yoqa runs create <app> --cases 1 --device web-chrome --wait                  # signed in; report: Profile kept
yoqa runs create <app> --cases 1 --device web-chrome --profile clean --wait  # signed out; report: Profile clean
```

## Follow-ups

- `yoqa devices connect` has no `--app` or `--clean` yet; the route takes both.
- The desktop app has no control for a Run's profile yet; a Case Script that says `profile: clean` is the way to ask from there.
- Windows Chromium locks the profile with a `lockfile` held open, not `SingletonLock`; the lock rules here are POSIX only, which is where discovery runs today.
- A live pid that has been reused by another program reads as a held profile; the error names the pid so the user can check.
