# Yoqa updates in Yoqa Desktop

A **Yoqa update** is a newer version of Yoqa Desktop, found and downloaded in the background and applied only when the user chooses to restart (glossary: [`CONTEXT.md`](../../CONTEXT.md) › Distribution). Where updates are served from, and why, is [ADR-0013](../adr/0013-yoqa-updates-from-github-releases.md). Spec: issue #472.

## Goal

Yoqa Desktop tells its users a newer version exists, downloads it in the background (the delta patch when the installed version is the one just before it, otherwise the full archive), and installs it when they press **Restart**, instead of making them notice a GitHub Release and reinstall by hand.

## Plan summary

- **One test seam: the Yoqa update controller** in the desktop main process. It gets an `updater` (check, download, apply, and `takeFailedApply()` from #476), the Electrobun channel, a timer, `now()`, `isRunInProgress()` (#474), `readAutoCheck()` (#475) and an `onStatus` push; its interface is `start()`, `checkNow()`, `autoCheckChanged()`, `restart()` and the status snapshot. Tests drive only that interface with fakes.
- **Electrobun stays behind a thin wrapper.** Electrobun 1.18's `Updater` reports failures as an `error` string or a status event rather than by throwing; the wrapper turns each into a thrown error so the controller has one failure path. The wrapper is not unit-tested; the release smoke in #478 covers it.
- **Failures are quiet.** A failed check or download records `lastError` and goes back to `idle`, or stays `ready` when an update is already downloaded. No toast, no retry loop.
- **A ready update keeps its banner** while Yoqa checks again; the snapshot only leaves `ready` for a newer version's download, or when a check says Yoqa is up to date (the release was rolled back).
- **A schedule, not a retry loop.** The controller checks 10 s after launch and then 6 hours after each scheduled check ends; a failed check or download is retried only by that next scheduled check. A manual **Check for updates** doesn't move the schedule. Rejected: a fixed 6-hour interval from launch (a slow download could overlap the next tick) and a shorter retry after a failure (the spec wants failures quiet).
- **The toggle is read through `readAutoCheck()` and re-read on change.** "Check for updates automatically" is stored with the other desktop settings (`yoqaUpdate.autoCheck` in the stored-settings file; missing means on). Storing it calls the controller's `autoCheckChanged()`, so the change takes effect without a restart: off cancels the pending automatic check, on schedules the next one 6 hours after the last check (at least 10 s from now, or 10 s from now if Yoqa never checked). Rejected: re-reading the setting only when a scheduled check fires (turning it off would still leave one check pending, and turning it on would never reschedule).
- **Checks answer at once over RPC.** A download can outlast the 60 s RPC timeout, so `checkForYoqaUpdate` starts the check and returns the current snapshot; the result arrives as a pushed `yoqaUpdateStatus` message.
- **A failed apply is remembered by Yoqa, not Electrobun** (#476). Electrobun keeps nothing about an apply across the relaunch and keeps the old Yoqa when it fails, so the production `updater` saves a pending-apply marker (target version, running build hash) in Yoqa's stored settings just before applying. On the next launch `updater.takeFailedApply()` reads and clears it; still running the same hash means the apply failed. The controller only sees that one call, so its tests stay fakes-only. Rejected: comparing versions (a reinstall of the same version would look like success; Electrobun's own "update available" is a hash compare too) and a separate controller dep for the marker.
- **`error` means "this Yoqa update didn't install"**, in this session (`restart()` whose apply throws) or the last (the marker). It carries the failed `version` and stays through failed checks; the next successful check or download clears it (back to `ready` when the same update is still on disk, otherwise downloading it again). Rejected: staying `ready` after an in-session failure, because the banner can't tell an apply failure from a later failed check and failures are meant to be quiet.
- Rejected: a separate "current version" field in the snapshot (kept to the spec's shape; the installed version is its own `getYoqaVersion` request); showing check failures as toasts.

## What shipped

Tracer bullet, #473:

- **Controller** (`apps/desktop/src/bun/features/yoqa-update/controller.ts`): launch check 10 s after start, checking → downloading → ready with the version, `lastCheckedAt` on every finished check, `lastError` on failure with a ready update kept, overlapping checks joined, `restart()` applying once (a failed apply records `lastError`; #476 turned it into `error`), never an apply without `restart()`, nothing at all on Electrobun's `dev` channel. `restartHeld` came with #474.
- **Electrobun wrapper** (`electrobun-updater.ts`) and wiring (`index.ts`, `apps/desktop/src/bun/index.ts`).
- **Desktop RPC** (`apps/desktop/src/shared/rpc.ts`, types in `shared/yoqa-update.ts`): requests `getYoqaVersion`, `getYoqaUpdateStatus`, `checkForYoqaUpdate`, `restartForYoqaUpdate`; the first Bun → webview message, `yoqaUpdateStatus`, heard through `onYoqaUpdateStatus` in `app/desktop-rpc.ts`.
- **Webview feature** `features/yoqa-update/` (desktop feature layout): the snapshot in the module observable `yoqaUpdate$`, mirrored by the root `YoqaUpdateSync`; the banner under the session bar ("Yoqa vX is ready", **What's new** to `releases/tag/vX`, **Restart**); Settings › **Updates** with the installed version, the result line, "Last checked …", the last error and **Check for updates**. Copy and the release link live in `utils/yoqa-update-copy.ts` with tests.

Restart hold, #474:

- **The hold rule.** A ready Yoqa update never restarts Yoqa while a Run is in progress, because applying quits Yoqa and its runner and would kill the Run mid-case. "In progress" means the local runner has a Run with status `running`, in any App. A connected Active Session with no Run in progress holds nothing.
  - `restartHeld` is true while a ready update waits on a Run. The controller asks the runner (`isRunInProgress()`) as the update becomes ready, then every 5 s (`RUN_RECHECK_INTERVAL_MS`) while it stays ready, so the hold appears when a Run starts and clears within about 5 s of the Run ending. The loop stops once no update is ready.
  - `restart()` asks again before applying; while a Run is in progress it sets `restartHeld` and does not apply.
  - A runner that can't answer (down, or no answer within 5 s) counts as no Run in progress, so a broken runner never blocks a Yoqa update.
- **Runner contract.** `GET /runs?status=running` without an `appId` lists the Runs in progress across every App (`listRunsInProgress()` in the Runs domain, `RunnerClient.listRunsInProgress()`). With an `appId` the route is unchanged; with neither it is still a 400.
- **Banner.** While `restartHeld`, Restart is disabled and the banner says "Waiting for the Run to finish" (`restartHeldText` in `utils/yoqa-update-copy.ts`).

Schedule and toggle, #475:

- **Controller:** `start()` reads `readAutoCheck()` and schedules the launch check only when it's on; each scheduled check schedules the next one `AUTO_CHECK_INTERVAL_MS` (6 h) after it ends; `checkNow()` ignores the toggle; `autoCheckChanged()` cancels or schedules. Tests use the fake timer for the launch check and every 6 hours after, no automatic checks when off with `checkNow()` still checking, a failure retried only at the next scheduled check, and the toggle taking effect without a relaunch.
- **Stored setting:** `StoredSettings.yoqaUpdate` in `apps/desktop/src/bun/features/app-settings/store.ts`; `readYoqaUpdateSettings()` / `writeYoqaUpdateSettings()` in `features/yoqa-update/index.ts`.
- **Desktop RPC:** `getYoqaUpdateSettings` and `setYoqaUpdateSettings` (`{ autoCheck }`), stubbed in `apps/desktop/e2e/stub-desktop-rpc.ts`.
- **Settings › Updates:** a "Check for updates automatically" switch (on by default) under the version card, through `useYoqaUpdateSettings` / `useSetYoqaUpdateSettings`; the intro now says "when it launches and every 6 hours after". **Check for updates** works whether the switch is on or off.

Apply failure, #476:

- **Controller:** `start()` asks `updater.takeFailedApply()` before the launch check and reports a hit as `state: "error"` with that `version` and `lastError` ("Yoqa vX didn't install; Yoqa relaunched on the version you had"). A `restart()` whose apply throws now goes to `error` with the version and the apply's message instead of staying `ready`. A failed check keeps the `error`; a successful check or download clears it. The launch report is not network traffic, so it runs whether or not **Check for updates automatically** is on; with the switch off, the `error` stays until a manual **Check for updates**.
- **With the restart hold:** a `restart()` held by a Run in progress never reaches `apply`, so it never records a failed apply; while the snapshot is `error` the 5 s Run re-check reports `restartHeld: false`, and the hold picks up again once a check brings the update back to `ready`.
- **Marker:** `failed-apply.ts` (`createFailedApplyTracker`, tested with an in-memory store) and the stored-settings key `yoqaUpdatePendingApply` in `~/Library/Application Support/yoqa/settings.json` (`patchStoredSettings` now spreads the whole patch, so top-level keys like this one persist). The Electrobun wrapper saves the marker right before `Updater.applyUpdate()` and clears it when the apply returns instead of quitting (that failure was already shown in-session). A marker that can't be written never blocks the apply.
- **Webview:** the banner shows "Yoqa vX couldn't be installed, so Yoqa kept the version you had" with **Download vX by hand** to `releases/tag/vX` while `state` is `error` (`yoqa-update-failed-banner.tsx`); Settings › Updates says "Yoqa vX couldn't be installed" with the error under it.

## When a Yoqa update fails to apply

What the user sees: Yoqa still opens on the old version, the banner says the update couldn't be installed and links its release page, and Settings › Updates shows the error. The next check (about 10 s after launch when automatic checks are on, or **Check for updates**) offers the update again; it reuses the archive already on disk when there is one.

What Electrobun leaves behind (`self-extraction/` in its app data folder: macOS `~/Library/Application Support/ai.yoqa.app/stable/`, Windows `%LOCALAPPDATA%\ai.yoqa.app\stable\`): the downloaded `<hash>.tar`, on macOS possibly an extracted `.app`, on Windows `temp-<hash>/` and `update.bat`. None of it stops Yoqa from running.

Recover by hand when retrying keeps failing:

1. Quit Yoqa.
2. Open the release page from the banner (or `https://github.com/Aris-ngoy/qa-agent/releases/latest`) and download the installer: macOS `stable-macos-arm64-yoqa.dmg`, Windows `stable-win-x64-yoqa-Setup.zip`.
3. macOS: drag `yoqa.app` into Applications and replace the old one, then clear quarantine with `xattr -cr /Applications/yoqa.app` ([macOS release](macos-release.md)). Windows: extract the zip and run `yoqa-Setup.exe` ([Windows release](windows-release.md)).
4. If the next update fails the same way, delete the `self-extraction/` folder above so Yoqa downloads the full archive afresh.

If Yoqa is gone or won't open after a Restart (macOS deletes the old `.app` before moving the new one in; the Windows `update.bat` can stop after deleting part of the old app), steps 2–3 reinstall it. Stored settings, `~/.yoqa` (Apps, Test Cases, Runs) and secrets live outside the app and survive a reinstall.

## How to verify

1. `bun run lint:ci`, `bun run test`, `bun run check`. `bun test apps/desktop/src/bun/features/yoqa-update apps/desktop/src/mainview/features/yoqa-update` runs just this feature.
2. `bun run desktop` (the `dev` channel): Settings › Updates says development builds don't check, and **Check for updates** is disabled; no request goes to GitHub.
3. A packaged build older than the latest release: about 10 s after launch the banner shows "Yoqa vX is ready"; **What's new** opens that release page; **Restart** installs and relaunches. Settings › Updates shows the result of each **Check for updates**. Offline, a check leaves only the last error in Settings.
4. Restart hold: with a Yoqa update ready, start a Run. Within about 5 s Restart is disabled with "Waiting for the Run to finish"; once the Run ends it is enabled again within about 5 s. `curl 'http://127.0.0.1:7420/runs?status=running'` lists the Run while it runs.
5. Automatic checks: Settings › Updates › turn **Check for updates automatically** off, quit and relaunch: the switch is still off, no check happens after launch ("Last checked" doesn't change), and **Check for updates** still checks. Turn it back on: a check follows within 10 s if Yoqa hadn't checked in the last 6 hours. The value lives under `yoqaUpdate.autoCheck` in `~/Library/Application Support/yoqa/settings.json`.
6. Failed apply on the next launch: in a packaged build's stored settings, set `"yoqaUpdatePendingApply": { "version": "9.9.9", "fromHash": "<this build's hash from Resources/version.json>" }` and launch: the banner shows "Yoqa v9.9.9 couldn't be installed…" with **Download v9.9.9 by hand**, Settings shows the error, and the marker is gone from `settings.json`. A launch with any other `fromHash` shows nothing.

## Follow-ups

- #474 (shipped): a Run left `running` in the catalog by a runner that was killed (not stopped) holds the restart until it is cancelled or deleted. The runner has no startup sweep for such Runs yet; adding one (mark leftover `running` Runs as cancelled with "The runner stopped") would fix both the hold and the Runs list.
- #476 is done. #478 should confirm on real builds that a failed Windows `update.bat` relaunch (or none) still lands on the failure banner; if `update.bat` stops before relaunching, the user starts Yoqa by hand and then sees it.
- #477: `release.baseUrl` and patch generation in the release build.
- #478: the first real update on macOS and Windows; confirm the runner and `yoqa --version` follow.
