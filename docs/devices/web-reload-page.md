# Web: Reload (a page)

## Goal

Give a Browser device the equivalent of a browser's F5: load the page the Device Session drives again, at the URL it is on now. Before this there was no way to reload. **Restart** clears storage on a browser Yoqa launched and goes back to the App's URL, and **open URL** goes to a URL you name. Neither one is a reload. Vocabulary: **Reload (a page)**, **Restart (an App)**, **Action**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **A new Action, not an F5 key.** The `key` Action sends synthetic keys over CDP (`Input.dispatchKeyEvent`), and synthetic keys never trigger the browser's own shortcuts. An `F5` in `KEY_NAMES` would press a key the page ignores. So `reload-page` calls `Page.reload` instead.
- **Plain reload only.** Cookies, storage and logins are kept, and the cache is used. A hard reload (`ignoreCache`) was left out until someone needs it.
- **Web only, and it fails loudly elsewhere.** Android, the iOS simulator and the cabled iPhone declare `reloadPage` unsupported with "reload-page is web only: …". A cross-platform case can't pass a step it never ran, and a reload isn't quietly turned into a Restart.
- **Waits like `openUrl`.** It waits for the new document's load event, up to the same 10 s cap. A slow page carries on rather than failing, then the Action Settles. The result adds nothing beyond the usual Result screenshot (there is no `kept`/`cleared` like Restart has).
- **Available everywhere Actions are:**
  - a Case Script step, `- reload-page: {}` (`- reload-page:` reads too). This follows the file's existing keyed form for a step with no fields, like `background-app`.
  - `yoqa action reload-page` in the CLI
  - the shell export and import
  - the agent's decision list. There's one list for every platform, marked "web only" (the `background-app` precedent), rather than a prompt built per platform.
- **Inspector: a header button plus F5 / ⌘R.** The button sits in the Device panel header. The Scroll/Wait helpers live in the element dialog, which only opens once an element is selected, so a button there would be hard to reach. Both the button and the shortcuts reload now and append a `reload-page` step, the way Insert & Run does. They show and respond only when all of these hold:
  - a Browser device is connected
  - no script is running
  - no Run holds the session view-only
  - focus isn't in a field or the script editor

  Shift+F5 and ⇧⌘R are hard-reload chords, so they're left alone. The app menu has no ⌘R, so nothing else claims the shortcut.
- No ADR: this is cheap to reverse, and nothing was a real trade-off.

## What shipped

- **Runner**
  - `lane.ts` and `device-session.ts`: `reloadPage` is a new optional Lane member. Each Lane implements it or declares why it can't.
  - `web-direct-lane.ts`: `reloadPage` uses `Page.reload`. Navigation and reload share one `untilLoaded` wait.
  - `interaction.ts`: `reload-page` performs it.
  - `cdp-client.ts`: the `Page.reload` type.
  - `fake-cdp.ts`: reloads are counted.
  - `android-direct-lane.ts`, `ios-direct-lane.ts`, `ios-device-lane.ts`: declared unsupported.
- **Runs:** `agent.ts` accepts and maps the `reload-page` decision, and its prompt gains a "web only" rule. `script.ts` saves it into a Run's Case Script.
- **Client (`@yoqa/runner-client`):** `reload-page` is in `actionKindSchema` and the Case Script schemas. Replay, run-report labels ("Reload page"), shell export (`yoqa action reload-page`) and shell import all handle it.
- **CLI:** `yoqa action reload-page`.
- **Desktop Inspector**
  - A Reload button in the Device panel header.
  - `useReloadShortcut`, with the pure `isReloadShortcut` and `isTypingTarget` checks in `utils/reload-shortcut.ts`.
  - `handleReloadPage` in `use-script-session.ts`.
  - "Reload page" in the step list and the saved-script summary.
- **Docs:** the skill's lifecycle table (shipped and local copies), `agent-cli-parity.md`, `saved-scripts.md`, and the **Reload (a page)** term in `CONTEXT.md`.

## How to verify

```bash
bun test services/runner/src/domains/devices/web-direct-lane.test.ts -t "reload-page"
bun test services/runner/src/domains/devices/device-session.test.ts services/runner/src/domains/devices/lane-contract.test.ts
bun test apps/desktop/src/mainview/features/inspector/utils/reload-shortcut.test.ts
bun run lint:ci && bun run test && bun run check
```

Manually:
1. Connect a Browser device in the Inspector. A **Reload** button appears in the Device header.
2. Click it, or press F5 / ⌘R with focus outside the script editor. The page reloads, logins are kept, and `- reload-page: {}` is appended to the script.
3. Run `yoqa action reload-page` against the same session.
4. On a simulator, the button isn't shown, and `yoqa action reload-page` answers 422 with "reload-page is web only".

## Follow-ups

- A hard reload (`ignoreCache`, Shift+F5) if someone needs it.
