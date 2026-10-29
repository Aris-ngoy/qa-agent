# Web: a Kept profile per App and browser

## Goal

Never sign in twice. A browser Yoqa launches used to start on a throwaway profile that disconnecting deleted, so every connect and every Run met the app's sign-in screen again. A launched browser now keeps its profile per App and browser across disconnects, reconnects and Runs ([#364](https://github.com/Aris-ngoy/qa-agent/issues/364), the tracer bullet of the decision in [#346](https://github.com/Aris-ngoy/qa-agent/issues/346), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). Vocabulary: **Kept profile**, **Browser device**, **Device Session** in [`CONTEXT.md`](../../CONTEXT.md). Background: [web-installed-browsers.md](./web-installed-browsers.md), [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **One Kept profile per App and browser**, at `~/.yoqa/browser-profiles/<appId>/<browserId>/`, the same `~/.yoqa` root as the catalog. Per App because apps under test often need different accounts; per browser because Chromium profiles are not safe to share across browsers or versions. A connect with no App uses `default`. Rejected: profiles the user names.
- **Disconnect keeps the folder.** The browser is killed as before; only a clean profile is deleted.
- **A clean profile on request.** `profile: "clean"` is the old `mkdtemp` profile, deleted on disconnect. `kept` is the default.
- **Launch flags are unchanged.** `--use-mock-keychain` and `--password-store=basic` stay, or macOS asks for the keychain on every launch. Trade-off: the profile's cookies are protected by the user's account files, not the keychain.
- **Already open:**
  - a connect to the browser the Active Session already drives (same device, App, profile and Viewport preset) returns that session, with no second launch. A connect that differs in any of those replaces the session, as before;
  - a `SingletonLock` whose `<hostname>-<pid>` names another host or a pid that is gone is stale: it, `SingletonSocket` and `SingletonCookie` are removed and the launch goes ahead;
  - a lock held by a live pid on this host fails the connect with `ProfileInUseError`, naming the folder and the pid.
- **The last browser's `DevToolsActivePort` is deleted before launch**, or the launch would read the old port back from the kept folder and connect to nothing.
- **An App id must be one plain folder name** (letters, digits, `.`, `_`, `-`, not `.` or `..`), checked by the connect schema (a 400) and again when the folder is named, so a Kept profile never lands outside its root.

## What shipped

- `chromium-browsers.ts`: `launchChromium(browser, deps, { appId, profile })` launches on `keptProfileDir(browserId, appId)`, made if missing, after clearing a stale lock and the old port file; `stop` deletes only a clean profile, and a failed launch keeps a Kept one. `LaunchDeps` gains `home` and `isProcessAlive` for tests. `ProfileInUseError` for a profile a live browser holds.
- `@yoqa/runner-client`: `browserProfileSchema` (`kept` | `clean`), and `appId` and `profile` on `connectDeviceRequestSchema`.
- `SessionOptions` gains `appId` and `profile` (web only), passed from `POST /devices/connect` through `connectDevice` to the web Direct lane's `launch`. `webDirectDeps` takes a `home` override.
- `active-session.ts`: `connectDevice` returns the Active Session for a connect to the browser it already drives.
- Tests: launch, keep, relaunch, clean, stale and live locks in `chromium-browsers.test.ts`; the lane keeping the profile across a disconnect and a Dead Session in `web-direct-lane.test.ts`; the route, the default App, clean, and the second connect in `active-session.test.ts`. Every launch in the tests, including the Lane contract harness, uses a temporary home.
- `CONTEXT.md`: **Kept profile**, and **Browser device** says a launched browser uses its App's Kept profile.

## How to verify

```bash
cd services/runner
bun test src/domains/devices/chromium-browsers.test.ts src/domains/devices/web-direct-lane.test.ts src/domains/devices/active-session.test.ts
```

By hand on a Mac with Chrome, with the runner up:

```bash
curl -s localhost:<port>/devices/connect -H 'content-type: application/json' \
  -d '{"deviceId":"web-chrome","platform":"web","appId":"<app id>"}'
```

Sign in to a site in the window, `POST /devices/disconnect`, connect again: the site is still signed in, and `~/.yoqa/browser-profiles/<app id>/web-chrome/` is there. With `"profile":"clean"` the window starts signed out and its temp folder is gone after disconnect. Opening the same folder in another Chrome (`--user-data-dir=…`) and connecting fails with an error naming the folder.

## Follow-ups

- Reset: `yoqa devices web reset-profile [--app]` and the runner route ([#365](https://github.com/Aris-ngoy/qa-agent/issues/365)); the desktop app's "Reset browser profile" and its device picker copy, which still says throwaway profile ([#366](https://github.com/Aris-ngoy/qa-agent/issues/366)); Runs passing their App and `profile: clean` ([#367](https://github.com/Aris-ngoy/qa-agent/issues/367)). Until then a Run's launched browser uses the `default` Kept profile.
- `yoqa devices connect` has no `--app` or `--clean` yet; the route takes both.
- Windows Chromium locks the profile with a `lockfile` held open, not `SingletonLock`; the lock rules here are POSIX only, which is where discovery runs today.
- A live pid that has been reused by another program reads as a held profile; the error names the pid so the user can check.
