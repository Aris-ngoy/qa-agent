# Web: the Everyday browser, by consent, in Yoqa's own window

## Goal

Let a user test in their real session: the account, extensions and state their own browser already has. Yoqa connects to the user's running Chromium browser on its default profile through the consent toggle at `chrome://inspect/#remote-debugging`, and drives a page in a window of its own ([#370](https://github.com/Aris-ngoy/qa-agent/issues/370), the tracer bullet of [ADR-0009](../adr/0009-everyday-browser-consent-attach.md), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). Then keep that session safe and the user's consent explicit: no wipes, Runs only when named, and a first-use warning per App ([#371](https://github.com/Aris-ngoy/qa-agent/issues/371)). Then let the CLI list and connect it, and teach an agent to ask the user for the toggle and the Allow ([#373](https://github.com/Aris-ngoy/qa-agent/issues/373)). The Kept profile ([web-kept-profile.md](./web-kept-profile.md)) stays the default way in. Vocabulary: **Everyday browser**, **Browser device**, **Device Session**, **Viewport preset**, **Frame Feed** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **One device per installed browser**: `web-chrome-everyday`, `web-edge-everyday`, `web-brave-everyday`, `web-chromium-everyday` and `web-dia-everyday`, next to the launched `web-chrome` etc. Dia was listed here before Yoqa launched it, since the consent path was confirmed on it first (#355); `web-dia` now launches it too (#377). Arc, Opera and Vivaldi (`web-arc-everyday`, `web-opera-everyday`, `web-vivaldi-everyday`) are listed when installed, marked unverified (#378).
- **Discovery reads the port file and probes HTTP, never a socket.** Each browser's default user-data folder on macOS (`~/Library/Application Support/Google/Chrome/`, `…/Microsoft Edge/`, `…/BraveSoftware/Brave-Browser/`, `…/Chromium/`, Dia's `…/Dia/User Data/`, and, unverified, Arc's `…/Arc/User Data/`, Opera's `…/com.operasoftware.Opera/` and Vivaldi's `…/Vivaldi/`) holds `DevToolsActivePort` while the toggle is on. A device is `ready` when the file names a port where a plain `GET /json/version` gets any HTTP answer (the toggle answers 404); otherwise `remote debugging off`. A stale file, which Dia leaves behind, names a port nothing answers on. Opening a WebSocket would raise the Allow prompt, so discovery never does.
- **One socket per connect.** The connect opens `ws://127.0.0.1:<port><path>` from the file once and waits up to 60 s for the user's Allow. It is never retried, since each attempt prompts again. A socket that fails or closes before it opens is `Remote debugging was denied in <Browser>`; no answer in time is `<Browser> did not answer the Allow prompt within 60 s`. The request's abort signal cancels the wait: a client that hangs up on `POST /devices/connect` ends it.
- **The resolve step is the only difference.** After the socket opens, the session is the web Direct lane's, as for attach by port and a launched browser: Viewport preset, Screen, Actions, the screencast Frame Feed, popups.
- **Yoqa's own window.** The session's page is `Target.createTarget { url: "about:blank", newWindow: true }`, with no `browserContextId`. It never lists or attaches to the user's targets, so the Screen, screenshots and the Stream only ever come from that page or a popup it opens. terminate-app's blank page also opens in a new window.
- **Disconnect closes only Yoqa's pages** (its page, and any popup chain it followed), then the socket. The browser, the user's tabs and the toggle stay as they were. The user closing Yoqa's window is a Dead Session, as on any web device.
- **The profile name** the window opened in is read from the browser's `Local State`: `profile.info_cache[profile.last_used].name`, `Default` when none was last used, or null when the file cannot be read. It is on the connect answer as `browserProfileName`.
- Rejected: probing with a WebSocket in discovery (prompts on every list), retrying a failed connect (prompts again), and attaching to the user's front tab (ADR-0009).
- **No wipes (#371).** restart-app there closes Yoqa's page and opens the Web URL again in a new window of its own, without `Storage.clearDataForOrigin`, which would sign the user out of their real account. No other lane call clears cookies, storage or cache either. The Action's result says `storage: "kept"` (`"cleared"` on a launched or attached browser).
- **The first-use warning, per App.** `POST /devices/connect` to an Everyday browser answers 428 `EVERYDAY_WARNING_REQUIRED` with the warning text and the App, before opening any socket, until a request says `acceptEverydayWarning: true` for that App (`default` with no App). The acceptance is kept in the catalog's `everyday_warning_acceptances` table, keyed by App id, so the desktop and the CLI share it; a table rather than an `apps` column because `default` is no App. Deleting an App deletes its row. Gated at the HTTP route, not in `connectDevice`, so the restart of an already-connected session from the servers list does not ask again.
- **Runs only when named.** `createRun` on an Everyday device fails before the Run starts when its App has not accepted the warning, and when the Run resolves to `profile: clean` (from the request or a Case Script), with a message pointing to the launched browser's Kept profile for a clean start. `yoqa runs create` with no `--device` refuses to fall back to an Active Session on an Everyday browser. A Run adopts an Everyday Active Session whichever App it was connected for, since reopening would prompt again and there is only the user's profile.
- **The report names it.** The Run stores `browser` as `Everyday <Browser> <version>` and the connect's `browserProfileName` (column `browser_profile_name`), and no `profile`: it is neither Kept nor clean. The report's Browser row reads `Everyday Google Chrome 144.0 · profile Work` in HTML, Markdown and the GitHub summary.
- **The CLI (#373).** `yoqa devices web` prints each Everyday browser's state, and an off one gets the line `Turn it on at chrome://inspect/#remote-debugging, then connect`. `yoqa devices connect web-<browser>-everyday` prints `Click Allow in <Browser>… (up to 60 s; Ctrl-C cancels)` on stderr, so `--json` stays clean, once the runner has not answered within 250 ms: the runner refuses an unaccepted App at once, before any prompt, so that refusal never says to click Allow, and there is no endpoint to ask first. Ctrl-C aborts the request, which ends the runner's wait (the request's signal), and exits 130. A Deny or timeout is the runner's message, exit 1. On success the session line ends `profile Work`.
- **`--yes` and `--app` on connect.** The 428 prints the warning and the command to run again with `--yes`, which sends `acceptEverydayWarning: true`; the runner remembers it, so later connects need no flag. `--app <prefix|id>` names the App the warning is for (and a launched browser's Kept profile), resolved in the catalog and refused for an App it does not have; without it the App is `default`. Rejected: an interactive y/N prompt, which an agent or CI cannot answer and which `--yes` covers.
- **Attach by port** (`chromium-cdp-<port>`) is unchanged, and documented as the CI path.

## What shipped

- `chromium-everyday.ts`: `findEverydayBrowsers`, `listEverydayDevices` (`ready` / `remote debugging off`; booted-only listing leaves out the off ones), `openEverydaySocket` (one attempt, `ALLOW_TIMEOUT_MS` = 60 s, injectable, cancellable, `EverydayConnectError` with the Deny, timeout and cancelled messages), and `readEverydayProfileName`.
- `cdp-client.ts`: `connectCdp` takes a `signal`, treats a close before open like an error, and fails with `CdpOpenError` (`refused`, `timeout`, `aborted`) so the Everyday connect can word each one. `Target.createTarget` takes `newWindow`.
- `web-direct-lane.ts`: `openBrowser` resolves and connects all three ways in; an Everyday browser gets its own window, `browser` is its name with the version it reports (`Google Chrome 144.0…`), `browserProfileName` is set, and `quit` closes Yoqa's targets before the socket. `webDirectDeps` takes `everydayBrowsers` and `allowTimeoutMs` for tests.
- `SessionOptions.signal`, passed from `POST /devices/connect` (`c.req.raw.signal`) through `connectDevice`. `browserProfileName` on `DeviceSession`, `ActiveSessionInfo` and `activeDeviceResponseSchema`.
- `GET /devices?platform=web` (and `yoqa devices web`) lists the Everyday browsers after the launched ones.
- #371: `restartApp` returns `{ storage }`, surfaced as `ActionResponse.storage`; `everyday-warning.ts` (`EVERYDAY_WARNING`, `EverydayWarningRequiredError`, `passEverydayWarning`); `isEverydayWarningAccepted` / `acceptEverydayWarning` in the catalog; `connectDeviceRequestSchema.acceptEverydayWarning`, `everydayWarningRequiredSchema` and the client's `everydayWarningRequired(error)` for #372 and #373; `Run.browserProfileName`; the CLI's `isEverydayDeviceId`, and `isWebDeviceId` takes Everyday ids. The fake CDP records every command's `methods`.
- #373: `connectEveryday` and the warning's refusal in `program.ts`; `everydayBrowserName` in the CLI's `platform.ts` (which `isEverydayDeviceId` now uses); `RunnerClient.connectDevice(request, { signal })`; `devices-everyday.test.ts` against a fake runner whose Chrome allows, Edge denies, Brave times out and Dia waits for Ctrl-C. The skill's `references/devices.md` says how to ask the user for the toggle and Allow, when to pass `--yes`, and never to relaunch the browser with a debug flag; the docs site's Web and CLI pages cover the same.
- Fake CDP: `consent` mode (`/json/*` is 404, each socket waits for `allow()` / `deny()`), with `socketRequests()`, `createdTargets` and `attachedTargets`. The Lane contract suite gains `webEverydayLane`, an Everyday Chrome with a tab of the user's own.

### Arc, Opera and Vivaldi (#378)

- **Folders**, under `~/Library/Application Support`: Arc `Arc/User Data`, Opera `com.operasoftware.Opera`, Vivaldi `Vivaldi`, from #349's draft and the vendors' known layouts. Unverified: not checked against an install. An entry whose folder has no `DevToolsActivePort` is `remote debugging off`, as for the others.
- **`verified: false`** on the three devices; the picker's Your browser rows and `yoqa devices web` add `unverified` after the state.
- **Open the setting** opens `chrome://inspect/#remote-debugging` in that app (`open -a Arc|Opera|Vivaldi`), the app named from `WEB_BROWSERS`. Whether each takes the page is unverified, and Opera may want `opera://inspect/#remote-debugging`, so an unverified entry's line adds "If the page doesn't load, open chrome://inspect/#remote-debugging in <Browser> yourself."
- **Tests:** `chromium-everyday.test.ts` finds the three in their folders, `verified: false`, off without a port file and ready with one. The desktop's `everyday-browser.test.ts` covers `everydayStateLine` and `turnOnHint`.

## How to verify

```bash
cd services/runner
bun test src/domains/devices/chromium-everyday.test.ts src/domains/devices/web-direct-lane.test.ts src/domains/devices/active-session.test.ts src/domains/devices/lane-contract.test.ts src/domains/runs/web-run.test.ts
cd ../../packages && bun test runner-client/src/run-report.test.ts cli/src/runs-create-web.test.ts cli/src/devices-everyday.test.ts cli/src/skill-docs.test.ts
```

The Everyday tests in `web-direct-lane.test.ts` fail if any command matching `Storage.clear…`, `Network.clear…` or `Network.deleteCookies` reaches the browser; `web-run.test.ts` fakes an Everyday Chrome for a whole Run by mocking `findEverydayBrowsers`.

By hand on a Mac with Chrome 144+ or Dia, with the runner up and the toggle on at `chrome://inspect/#remote-debugging`:

```bash
yoqa devices web                       # web-chrome-everyday … ready
yoqa devices connect web-chrome-everyday         # first use: prints the warning, exits 1
yoqa devices connect web-chrome-everyday --yes   # "Click Allow in Google Chrome…"; then "… profile Work"
yoqa action open-url --url https://example.com
yoqa action tap --label "More information..."
yoqa screenshot /tmp/page.png          # Yoqa's page only, never your tabs
yoqa action restart-app --app-id https://example.com --json   # "storage": "kept"; still signed in
yoqa devices disconnect                # Yoqa's window closes; Chrome and your tabs stay
```

Click Deny instead, or wait 60 s, and the connect fails with its own message and exits 1; Ctrl-C while it waits cancels it. Turning the toggle off lists the device as `remote debugging off`.

**Checked by hand on 2026-10-30**, on Dia 1.55.1 (Chromium 156), macOS 27.2, on the user's everyday profile:

- `yoqa devices web` listed `web-dia-everyday` as ready.
- A connect without `--yes` printed the warning and exited 1. With `--yes` it printed "Click Allow in Dia…", and connected once the user clicked Allow (`profile Personal`).
- `open-url`, `screen` and `tap --label "Learn more"` worked. The screenshot was Yoqa's page only.
- `restart-app` answered `"storage": "kept"`.
- `disconnect` closed Yoqa's window. Dia, its tabs and the toggle stayed, and the device was listed ready again.
- Ctrl-C while waiting cancelled the connect (`cancelled before Allow in Dia`, exit 130).

**Which profile does a `createTarget` with no `browserContextId` open in, with two profiles open?** The **default profile**, not the one in front.

- Dia had `Default` ("Personal") and `Profile 1` ("Works") open, with a Works window in front.
- Yoqa's window opened in Personal, and `browserProfileName` said `Personal`.
- `Local State`'s `profile.last_used` stayed `Default` throughout, so the name matched where the window opened.
- Opening in another profile needs that profile's `browserContextId`. That stays a follow-up.

## Follow-ups

- The same hand check on Chrome 144+ and Edge (only Dia is installed on the Mac it was checked on).
- The hand check on Arc, Opera and Vivaldi, which clears their `unverified`: the folder, the setting page (Opera's `opera://inspect`), Allow, disconnect.
- Whether a cancelled connect also closes the browser's Allow prompt, not only the runner's wait, was not observed.
- Windows paths ([#354](https://github.com/Aris-ngoy/qa-agent/issues/354)) and picking a profile other than the default context are not decided.

## When the connect gets stuck: not running, the re-check and the Allow wait

### Goal

On 2026-11-02, the desktop's **Your browser** tab got stuck twice, on desktop and runner 1.0.6 ([#415](https://github.com/Aris-ngoy/qa-agent/issues/415)):

- **Chrome stayed "Remote Debugging Off".** It was closed, but its leftover `DevToolsActivePort` made it look like an open Chrome with the setting off.
- **Dia was Ready, and the connect seemed to hang.** The runner was waiting on an Allow prompt the user could not see.

This work tells a closed browser apart from one with the setting off ([#416](https://github.com/Aris-ngoy/qa-agent/issues/416)), and makes the picker notice the setting turning on without being reopened ([#417](https://github.com/Aris-ngoy/qa-agent/issues/417)).

### Plan summary

- **Three states, in order.**
  1. `ready`: the port file names a port that gives any HTTP answer.
  2. `remote debugging off`: otherwise, while the user's own instance of the browser runs.
  3. `not running`: otherwise.

  A stale port file now falls through to step 2 or 3. Rejected: deleting or ignoring the file by age, which says nothing about whether the browser is open.
- **"The user's own instance runs" is a process check, never a socket.** It looks for a process of the app's binary with no `--user-data-dir`. A browser Yoqa launched on a Kept profile has that flag, so it doesn't count. A host whose processes can't be read counts the browser as running, which gives the wording from before.
- **A connect probes before it opens a socket.** A port that doesn't answer HTTP fails at once with no socket. A closed browser says `<Browser> is not running. Open it, turn on remote debugging at chrome://inspect/#remote-debugging, then connect again`. One with the setting off keeps its message. Before this, a stale file meant a socket attempt that failed as "Remote debugging was denied".
- **The picker re-checks every 2 s while an Everyday browser is not ready** (#417), and stops once all are ready or it closes. The rescan on open and on window focus stays: focus alone missed a user who turned the setting on and came back. A re-check is discovery, so it never opens a socket or raises the Allow prompt. Rejected: a file watch on each `DevToolsActivePort`, which misses a browser that opens or closes without writing it.
- **The desktop and CLI word it.** The desktop row's hint for `not running` says to open the browser first (Open the setting starts it). `yoqa devices web` prints `Open it, turn on remote debugging at chrome://inspect/#remote-debugging, then connect` under a closed one.

### What shipped

- **Runner:**
  - `EverydayBrowser.executable`.
  - `ProcessDeps.processArgs`, which reads `ps -axww -o args=` and is faked in tests.
  - `EverydayState` gains `not running`.
  - `listEverydayDevices` and `openEverydaySocket` share the port probe, and only the failure path reads processes.
- **CLI:** the `not running` line in `yoqa devices web`.
- **Desktop:** `turnOnHint` takes the entry's state. `everydayRecheckInterval` (2 s or off, from the listed devices) is the picker query's `refetchInterval`.
- **Docs:** the glossary's **Everyday browser** names its three states, and the skill's devices reference says what to ask the user for each.

### How to verify

```bash
cd services/runner && bun test src/domains/devices/chromium-everyday.test.ts
cd packages/cli && bun test src/devices-everyday.test.ts
cd apps/desktop && bun test src/mainview/features/devices/utils/everyday-browser.test.ts
```

By hand, with the picker open on Your browser and Chrome's setting off: turn it on in Chrome, and the row reads ready within about 2 s. Turn it off, and the row goes back.

By hand, on a Mac with Chrome:

1. Quit Chrome. `yoqa devices web` and the picker's Your browser tab read `not running`. A connect fails at once, without "Click Allow".
2. Open Chrome with the setting off: `remote debugging off`.
3. Turn the setting on: `ready`.

### Follow-ups

- The by-hand check above.
