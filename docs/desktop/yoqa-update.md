# Yoqa updates in Yoqa Desktop

A **Yoqa update** is a newer version of Yoqa Desktop, found and downloaded in the background and applied only when the user chooses to restart (glossary: [`CONTEXT.md`](../../CONTEXT.md) › Distribution). Where updates are served from, and why, is [ADR-0013](../adr/0013-yoqa-updates-from-github-releases.md). Spec: issue #472.

## Goal

Yoqa Desktop tells its users a newer version exists, downloads it in the background (the delta patch when the installed version is the one just before it, otherwise the full archive), and installs it when they press **Restart**, instead of making them notice a GitHub Release and reinstall by hand.

## Plan summary

- **One test seam: the Yoqa update controller** in the desktop main process. It gets an `updater` (check, download, apply), the Electrobun channel, a timer, `now()` and an `onStatus` push; its interface is `start()`, `checkNow()`, `restart()` and the status snapshot. Tests drive only that interface with fakes.
- **Electrobun stays behind a thin wrapper.** Electrobun 1.18's `Updater` reports failures as an `error` string or a status event rather than by throwing; the wrapper turns each into a thrown error so the controller has one failure path. The wrapper is not unit-tested; the release smoke in #478 covers it.
- **Failures are quiet.** A failed check or download records `lastError` and goes back to `idle`, or stays `ready` when an update is already downloaded. No toast, no retry loop.
- **A ready update keeps its banner** while Yoqa checks again; the snapshot only leaves `ready` for a newer version's download, or when a check says Yoqa is up to date (the release was rolled back).
- **Checks answer at once over RPC.** A download can outlast the 60 s RPC timeout, so `checkForYoqaUpdate` starts the check and returns the current snapshot; the result arrives as a pushed `yoqaUpdateStatus` message.
- Rejected: a separate "current version" field in the snapshot (kept to the spec's shape; the installed version is its own `getYoqaVersion` request); showing check failures as toasts.

## What shipped

Tracer bullet, #473:

- **Controller** (`apps/desktop/src/bun/features/yoqa-update/controller.ts`): launch check 10 s after start, checking → downloading → ready with the version, `lastCheckedAt` on every finished check, `lastError` on failure with a ready update kept, overlapping checks joined, `restart()` applying once (a failed apply keeps the update ready and records `lastError`), never an apply without `restart()`, nothing at all on Electrobun's `dev` channel. `restartHeld` is always false for now.
- **Electrobun wrapper** (`electrobun-updater.ts`) and wiring (`index.ts`, `apps/desktop/src/bun/index.ts`).
- **Desktop RPC** (`apps/desktop/src/shared/rpc.ts`, types in `shared/yoqa-update.ts`): requests `getYoqaVersion`, `getYoqaUpdateStatus`, `checkForYoqaUpdate`, `restartForYoqaUpdate`; the first Bun → webview message, `yoqaUpdateStatus`, heard through `onYoqaUpdateStatus` in `app/desktop-rpc.ts`.
- **Webview feature** `features/yoqa-update/` (desktop feature layout): the snapshot in the module observable `yoqaUpdate$`, mirrored by the root `YoqaUpdateSync`; the banner under the session bar ("Yoqa vX is ready", **What's new** to `releases/tag/vX`, **Restart**); Settings › **Updates** with the installed version, the result line, "Last checked …", the last error and **Check for updates**. Copy and the release link live in `utils/yoqa-update-copy.ts` with tests.

## How to verify

1. `bun run lint:ci`, `bun run test`, `bun run check`. `bun test apps/desktop/src/bun/features/yoqa-update apps/desktop/src/mainview/features/yoqa-update` runs just this feature.
2. `bun run desktop` (the `dev` channel): Settings › Updates says development builds don't check, and **Check for updates** is disabled; no request goes to GitHub.
3. A packaged build older than the latest release: about 10 s after launch the banner shows "Yoqa vX is ready"; **What's new** opens that release page; **Restart** installs and relaunches. Settings › Updates shows the result of each **Check for updates**. Offline, a check leaves only the last error in Settings.

## Follow-ups

- #474: hold the restart while a Run is in progress (`restartHeld`).
- #475: check every 6 hours, and the "Check for updates automatically" toggle.
- #476: report an apply that failed after restart, with a manual download link.
- #477: `release.baseUrl` and patch generation in the release build.
- #478: the first real update on macOS and Windows; confirm the runner and `yoqa --version` follow.
