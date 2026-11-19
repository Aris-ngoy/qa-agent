# Yoqa updates in Yoqa Desktop

A **Yoqa update** is a newer version of Yoqa Desktop, found and downloaded in the background and applied only when the user chooses to restart (glossary: [`CONTEXT.md`](../../CONTEXT.md) › Distribution). Where updates are served from, and why, is [ADR-0013](../adr/0013-yoqa-updates-from-github-releases.md). Spec: issue #472.

## Goal

Yoqa Desktop tells its users a newer version exists, downloads it in the background (the delta patch when the installed version is the one just before it, otherwise the full archive), and installs it when they press **Restart**, instead of making them notice a GitHub Release and reinstall by hand.

## Plan summary

- **One test seam: the Yoqa update controller** in the desktop main process. It gets an `updater` (check, download, apply), the Electrobun channel, a timer, `now()`, `isRunInProgress()` (#474), `readAutoCheck()` (#475) and an `onStatus` push; its interface is `start()`, `checkNow()`, `autoCheckChanged()`, `restart()` and the status snapshot. Tests drive only that interface with fakes.
- **Electrobun stays behind a thin wrapper.** Electrobun 1.18's `Updater` reports failures as an `error` string or a status event rather than by throwing; the wrapper turns each into a thrown error so the controller has one failure path. The wrapper is not unit-tested; the release smoke in #478 covers it.
- **Failures are quiet.** A failed check or download records `lastError` and goes back to `idle`, or stays `ready` when an update is already downloaded. No toast, no retry loop.
- **A ready update keeps its banner** while Yoqa checks again; the snapshot only leaves `ready` for a newer version's download, or when a check says Yoqa is up to date (the release was rolled back).
- **A schedule, not a retry loop.** The controller checks 10 s after launch and then 6 hours after each scheduled check ends; a failed check or download is retried only by that next scheduled check. A manual **Check for updates** doesn't move the schedule. Rejected: a fixed 6-hour interval from launch (a slow download could overlap the next tick) and a shorter retry after a failure (the spec wants failures quiet).
- **The toggle is read through `readAutoCheck()` and re-read on change.** "Check for updates automatically" is stored with the other desktop settings (`yoqaUpdate.autoCheck` in the stored-settings file; missing means on). Storing it calls the controller's `autoCheckChanged()`, so the change takes effect without a restart: off cancels the pending automatic check, on schedules the next one 6 hours after the last check (at least 10 s from now, or 10 s from now if Yoqa never checked). Rejected: re-reading the setting only when a scheduled check fires (turning it off would still leave one check pending, and turning it on would never reschedule).
- **Checks answer at once over RPC.** A download can outlast the 60 s RPC timeout, so `checkForYoqaUpdate` starts the check and returns the current snapshot; the result arrives as a pushed `yoqaUpdateStatus` message.
- Rejected: a separate "current version" field in the snapshot (kept to the spec's shape; the installed version is its own `getYoqaVersion` request); showing check failures as toasts.

## What shipped

Tracer bullet, #473:

- **Controller** (`apps/desktop/src/bun/features/yoqa-update/controller.ts`): launch check 10 s after start, checking → downloading → ready with the version, `lastCheckedAt` on every finished check, `lastError` on failure with a ready update kept, overlapping checks joined, `restart()` applying once (a failed apply keeps the update ready and records `lastError`), never an apply without `restart()`, nothing at all on Electrobun's `dev` channel. `restartHeld` came with #474.
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

## How to verify

1. `bun run lint:ci`, `bun run test`, `bun run check`. `bun test apps/desktop/src/bun/features/yoqa-update apps/desktop/src/mainview/features/yoqa-update` runs just this feature.
2. `bun run desktop` (the `dev` channel): Settings › Updates says development builds don't check, and **Check for updates** is disabled; no request goes to GitHub.
3. A packaged build older than the latest release: about 10 s after launch the banner shows "Yoqa vX is ready"; **What's new** opens that release page; **Restart** installs and relaunches. Settings › Updates shows the result of each **Check for updates**. Offline, a check leaves only the last error in Settings.
4. Restart hold: with a Yoqa update ready, start a Run. Within about 5 s Restart is disabled with "Waiting for the Run to finish"; once the Run ends it is enabled again within about 5 s. `curl 'http://127.0.0.1:7420/runs?status=running'` lists the Run while it runs.
5. Automatic checks: Settings › Updates › turn **Check for updates automatically** off, quit and relaunch: the switch is still off, no check happens after launch ("Last checked" doesn't change), and **Check for updates** still checks. Turn it back on: a check follows within 10 s if Yoqa hadn't checked in the last 6 hours. The value lives under `yoqaUpdate.autoCheck` in `~/Library/Application Support/yoqa/settings.json`.

## Follow-ups

- #474 (shipped): a Run left `running` in the catalog by a runner that was killed (not stopped) holds the restart until it is cancelled or deleted. The runner has no startup sweep for such Runs yet; adding one (mark leftover `running` Runs as cancelled with "The runner stopped") would fix both the hold and the Runs list.
- #476: report an apply that failed after restart, with a manual download link.
- #477: `release.baseUrl` and patch generation in the release build.
- #478: the first real update on macOS and Windows; confirm the runner and `yoqa --version` follow.
