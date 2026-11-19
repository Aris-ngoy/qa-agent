# Reset (an App)

## Goal

Give QA engineers and their agents one Action that puts an App back in the state a fresh install leaves it in, without reinstalling it. Before this there were two options and neither did the job. **Restart** keeps the App's data everywhere except a browser Yoqa launched. A reinstall needs a Build on hand, is slow, and can't be written as one Case Script step. So suites either drifted into dirty state (flaky Runs) or ran hand-written wipe steps (`adb shell pm clear …`, editing simulator containers) that differ by platform. Spec: issue #485. Vocabulary: **Reset (an App)**, **Restart (an App)**, **Kept profile**, **Everyday browser**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **A new Action, `reset-app`, rather than a Restart flag.** It ends the App, clears its data, and leaves it installed and not running. It does **not** launch the App again: a clean cold start is two explicit steps, `reset-app` then `activate-app`. Rejected: a `restart-app --clear` option. Restart already clears storage on a launched browser, and a flag would blur the two terms.
- **The result says how far the wipe went.** The response gains `reset: { cleared, kept }`, drawn from a fixed vocabulary (`data`, `cache`, `preferences`, `permissions`, `app-groups`, `keychain`, `cookies`, `storage`, `service-workers`). Each Lane returns a fixed list, because what a wipe can reach differs by device.
- **An optional Lane member, as with `reload-page`.** A Lane that can't Reset declares why in `capabilities.unsupported`, and the runner answers 422 with that reason. The model for this is [`web-reload-page.md`](./web-reload-page.md).
- **Per Lane:**
  - **Android (adb):** check that the package is installed (`pm path`), because `pm clear` says nothing useful about a missing one. Then `am force-stop` and `pm clear --user current`. This clears data, cache, preferences, databases and files, and takes back runtime permissions.
  - **iOS simulator:** end the App, then delete its defaults domain through the simulator first, so the preferences daemon doesn't write cached values back. Then empty the data container and each app-group container (keeping their top-level folders) and reset privacy for the bundle. **The keychain is kept** unless `keychain: true` is passed, which resets the whole simulator's keychain. The keychain is shared by every app on the simulator, and a token kept there survives a real-device uninstall too.
  - **Cabled iPhone:** unsupported, with "A cabled iPhone cannot clear an app's data without reinstalling it".
  - **Web:** close the App's page and call `Storage.clearDataForOrigin` with every storage type. This runs whatever the connection's Restart storage setting is, so a browser attached by port clears too, while its Restart keeps storage. The page is not reloaded. Other origins and the rest of the Kept profile stay (`devices web reset-profile` still deletes the whole profile). **The Everyday browser** is unsupported, with "Yoqa never clears the Everyday browser's data".
- **Agents never pick it.** A wipe in the middle of a case can't be seen or undone. So the Run agent's Decide schema does not gain `reset-app`, and the Auto chat's `perform_action` tool excludes it. A person can still write it in a Case Script, and a Case Script learned from a passing Run never holds one.
- No ADR: it fits the existing optional-Lane-member pattern and is cheap to change.

## What shipped

- **Lane and CLI (#486):**
  - `reset-app` is in `actionKindSchema`, with `keychain` on the request and `reset` on the response (`@yoqa/runner-client`).
  - `resetApp` is an optional Lane member, implemented on Android Direct, the iOS simulator Lanes and Web Direct. The cabled iPhone and the Everyday browser declare it unsupported.
  - `yoqa action reset-app --app-id <id> [--keychain]` prints `ok reset-app`, a `cleared …` line and, when something was kept, a `kept …` line, plus the usual Result screenshot lines. `--json` prints the raw response. `yoqa action batch` takes it like any other kind.
  - Guard tests pin that the Run agent and the Auto chat can't choose it.
- **Case Scripts (#487):** a `- reset-app: <app id>` step, with optional `keychain`, that round-trips through Case Script files, works inside a Branch's `then` / `else`, replays through `performAction`, and exports to the shell as `yoqa action reset-app`. The Run report shows the step with its cleared and kept lists.
- **Inspector (#488):**
  - The element dialog's app commands gain **resetApp**, right after **restartApp**. It is prefilled with the selected App's id and has an **Also reset the keychain** switch. Its command snippet is `yoqa action reset-app --app-id … [--keychain]`, and **Add to script** writes a `reset-app` Case Script step.
  - **Run on device** holds any Insert & Run that Resets an App until the user confirms it in a "Reset the app?" dialog. Cancel inserts and runs nothing. The held lines live on the script observable (`pendingReset`), and the check is a pure helper (`utils/reset-app.ts`). Rejected: confirming every script **Run** that has a `reset-app` step. A script someone wrote is already their choice, and a Test Case Run doesn't ask either.
  - After a Reset, the Inspector's run log line ends with the Lane's cleared and kept lists (`formatAppReset`). A script run's report keeps the same text as that step's detail.
- **Docs and skill (#489):**
  - The **Reset (an App)** glossary term. The Restart entry points to it, and the Kept profile entry now says "`reset-profile` deletes it".
  - The public docs: CLI, Case Script files, Web, Manual Inspector, and the App State Management guide, with a Reset / Restart / reinstall / `reset-profile` table.
  - The `yoqa-testing` skill's **Reset an App** section in `inspect-and-app-control.md` (with the same choice table), pointers to it from the install references, and the local `.agents` copy kept identical.

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "reset"
bun test packages/cli/src/action-reset-app.test.ts services/runner/src/domains/devices/batch.test.ts
bun test packages/cli/src/skill-docs.test.ts      # every documented yoqa command and flag exists
bun test apps/desktop/src/mainview/features/inspector/utils/reset-app.test.ts apps/desktop/src/mainview/features/inspector/utils/command-snippets.test.ts
bun run lint:ci && bun run test && bun run check
```

Manually:
1. On an Android emulator, sign in to the App, then run `yoqa action reset-app --app-id <package>`. It prints `ok reset-app` and `cleared data, cache, preferences, permissions`. `yoqa action activate-app --app-id <package>` opens it signed out, and permission prompts show again.
2. On an iOS simulator, the same command also prints `kept keychain`. With `--keychain`, the keychain is in the `cleared` line and there is no `kept` line.
3. On `web-chrome`, run `yoqa action reset-app --app-id <web url>`. The session moves to a blank page, and opening the URL shows the App signed out on that origin only.
4. On a cabled iPhone, or on `web-chrome-everyday`, the command fails with the Lane's reason and exits 1.
5. With an app id that isn't installed, it fails and names the App.
6. In the Inspector, pick an element, open **More commands**, choose **resetApp** and press **Run on device**. A confirm dialog opens. **Reset** runs it, and the log shows `✓ reset-app: … · cleared … · kept …`. **Cancel** leaves the script and the device untouched.

## Follow-ups

- A Run-level or Test Case-level "start from a Reset" option (for example `runs create --reset-app`). A Case Script's first step covers this for now.
- Android user or work-profile selection beyond the current user.
- A cabled-iPhone Reset, only if a supported way to clear an App's data without reinstalling appears.
