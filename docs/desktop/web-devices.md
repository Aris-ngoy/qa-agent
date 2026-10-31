# Desktop: web devices, Inspector and Runs

## Goal

Bring web into the desktop app ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301), stories 37–40; ticket [#311](https://github.com/Aris-ngoy/qa-agent/issues/311)). Installed browsers sit in the device picker next to simulators and phones. A connect names a **Viewport preset**, and a Chromium the user started can be attached by its port. The Inspector shows and drives the page through Screenshot Poll and reads the web Screen. The Runs panel starts Runs on a web device, and a Run's details name its browser, viewport and Lane. iOS and Android flows stay as they were. Vocabulary: **Browser device**, **Viewport preset**, **Frame Feed**, **Active Session**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **Web is a third platform in the top bar.** The session bar's platform select offers Web. Its picker is shaped for browsers, not phones: a **Browsers** tab (installed Chrome, Edge, Brave and Chromium, from `GET /devices?platform=web`, running or not) and an **Attach by port** tab (since replaced by **Your browser**, the [Everyday browser](#the-everyday-browser)). Rejected: putting browsers under the phone tabs ("Local Devices" / "Simulators"), which fit neither.
- **The preset is picked with the device.** A Desktop / Mobile choice above the tabs (sizes from `VIEWPORT_PRESETS`) is stored on the picked device and sent as `viewport` on connect. It is fixed for the session's life, so changing it means reconnecting. Restart reconnects at the session's own preset, and the remembered device keeps its preset across launches. Rejected: a separate preset control in the top bar, which would suggest it can change while connected.
- **Attach names a port, never a scan.** (The desktop form is gone since [#372](#the-everyday-browser); the CLI keeps attach by port.) The port becomes `chromium-cdp-<port>`. Such a device is never listed, so the bar names it from its id ("Chromium on port 9222"). The tab repeats how to start the browser (`--remote-debugging-port`, a non-default `--user-data-dir`).
- **The Inspector already polled.** It chose the Frame Feed from `streamReady` and a stream URL, so a web session (`streamState: none`) was already Screenshot Poll with the plain "Connected — screenshot poll" toast. That choice is now one tested function, `feedModeFor`, which polls whenever the runner says there is no Stream. The frame is shaped by the preset (a page, not a rounded phone), and the empty state no longer says "stream".
- **Runs read what the Run stored.** A web Run's details gain one line, `Browser Google Chrome 141.0 · Viewport mobile (390×844) · Lane Direct`, built from the Run's `browser`, `viewport` and `lane`. A phone's Run shows no such line, so its details are unchanged. The step screenshot frame takes the preset's shape on web.

## What shipped

- Device picker (`select-device-modal.tsx`, `web-device-panels.tsx`): Web title, the Viewport choice, the Browsers list (with a note that Yoqa opens its own window on the App's Kept profile; see [below](#the-apps-kept-profile-and-its-reset)), and the Attach-by-port form (removed with #372).
- `web-device.ts`: `attachDeviceId`, `attachedBrowser`, `browserDevices`, `viewportFor` (desktop by default, nothing on a phone), `withViewport` (`Google Chrome · mobile` in the bar) and `screenAspect`.
- Session bar: `connectRequestFor` in `session-app.ts` builds every connect (Connect, Restart, Run, trust reconnect) and adds `viewport` on web only. `deviceForSession` keeps the session's preset and names an attached browser. `RememberedDevice` carries an optional `viewport`, and an unreadable one is dropped.
- Inspector: `feedModeFor` in `inspect-session.ts`, used by the feed controller. The frame and its loading skeleton take the preset's aspect on web.
- Runs: `formatRunEnvironment` in `runs/labels.ts` for the details line, the preset-shaped screenshot frame, and web devices in the runs list's device lookup. `laneLabel` is shared with the session pill.
- The App editor's Web URL field shipped with [#309](https://github.com/Aris-ngoy/qa-agent/issues/309) ([web-runs.md](../runs/web-runs.md)).

## How to verify

```bash
bun test apps/desktop/src/mainview/features/devices apps/desktop/src/mainview/features/inspector/utils apps/desktop/src/mainview/features/runs/labels.test.ts
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome (not run here: this sandbox has no macOS browser or desktop shell):

1. Top bar → platform **Web** → Select device. The Browsers tab lists Google Chrome even with Chrome closed. Pick **Mobile**, then Google Chrome. The bar reads `Google Chrome · mobile`. Press Connect: a new Chrome window opens, and the toast says "Connected — screenshot poll".
2. Inspector → Connect Inspector. The page appears in a phone-shaped (390×844) frame without rounded phone corners. Hover shows the web Screen's boxes. Click an element for its actions, and "Use device" taps and swipes it as a finger.
3. Disconnect, pick Desktop, connect again: the frame is 1280×800.
4. Start Chrome with `--remote-debugging-port=9222 --user-data-dir="$(mktemp -d)"` and `yoqa devices connect chromium-cdp-9222` from the CLI: the bar reads `Chromium on port 9222`. Disconnect leaves that Chrome open. (The picker no longer attaches by port.)
5. Give the App a Web URL, select test cases, Run test. The Run opens the Web URL, and its details show `Browser … · Viewport … · Lane Direct` and step screenshots in the page's shape.
6. Switch to iOS or Android: the picker, Inspector and Run details look as before.

## Follow-ups

- The Inspector's command bar has no key picker yet ([key-action.md](../devices/key-action.md)).
- A CDP screencast Stream for the Inspector, and Run recording on web, stay out of scope (#301).
- The skill and public docs are [#312](https://github.com/Aris-ngoy/qa-agent/issues/312).

## Keeping the hover tree fresh

### Goal

The web Inspector's hover and pick tree is never older than the frame on screen ([#362](https://github.com/Aris-ngoy/qa-agent/issues/362), decided in [#348](https://github.com/Aris-ngoy/qa-agent/issues/348)). Before, it re-read the **Screen** every 8 s, and on a click only when the tree was more than 3 s old, so after a scroll or a navigation hover outlined where elements used to be. A phone keeps its behaviour.

### Plan summary

- **The runner says when a web page changed.** The web Direct lane counts `Page.frameNavigated`, `Page.navigatedWithinDocument`, `Page.lifecycleEvent` (now enabled on every page), every screencast frame it serves, the end of every Action, and a live-control pointer release. Chromium paints a screencast frame only when the view changed, so a scroll, an animation or new content reaches the Inspector through the **Frame Feed** it is already watching. Rejected: a scroll listener injected into the page (a script and a binding the page can see, in the user's own browser).
- **Debounced at the source.** A page loading or a scroll's frames is one signal once the page has been quiet for 200 ms; a page that keeps painting (an animation, a blinking caret) signals once a second.
- **Over the existing control socket.** `SessionOptions.onScreenChanged` reaches the Active Session, which sends `{ ok: true, type: "screen-changed" }` to every open `/ws/control` socket. On web the Inspector holds that socket open whenever it is attached and visible, not only under live control. Rejected: a second socket or an SSE route for one message.
- **The Inspector re-reads on it.** A change starts a tree read, or one more read when the one in flight ends, however many changes came during it. Under live control nothing is read until Select mode, which reads on the way in. Each Inspector action (tap, type, swipe, open URL, any Case Script step) counts as a change too.
- **The refresh rule.** A web tree is stale once the page changed after its read *began* (a change during the read may not be in it), or past 3 s. A phone's tree is stale with time only, and a phone is never read on a change: its tree read cuts its Stream. The 8 s timer stays as the backstop.

### What shipped

- Runner: `screen-changes.ts` (`debounceScreenChanges`), the web lane's change sources, `onActiveScreenChanged` in `active-session.ts`, and the signal on `/ws/control` (`control-ws.ts`). `controlScreenChangedMessageSchema` in `@yoqa/runner-client`.
- `FakeCdp` navigates as Chromium does (`Page.frameNavigated`, lifecycle events, load), lets the user follow a link (`navigate`) or scroll (`scroll`), and with `still` paints a screencast frame only when something changed.
- Desktop: `utils/tree-freshness.ts` (`isTreeStale`, `treeReadOnScreenChange`, `controlSocketWanted`, `isScreenChangedMessage`), `InspectorFeedController.screenChanged`, the control socket kept open on web, and a change after each Case Script step.

### How to verify

```bash
bun test services/runner/src/domains/devices/screen-changes.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts services/runner/src/domains/devices/active-session.test.ts apps/desktop/src/mainview/features/inspector/utils
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome (not run here: this sandbox has no macOS browser or desktop shell):

1. Connect a web device, open a long page, Inspector → Connect Inspector, Select mode.
2. Scroll the page in the browser window (or with a swipe from the Inspector). Within about a second, hovering outlines the element under the pointer, not where it was before the scroll.
3. Follow a link in the browser: hover matches the new page without pressing refresh.
4. Connect a phone: the tree refreshes as before (on its timer and after commands), and the Stream does not pause on page changes.

### Follow-ups

- The by-hand check above on a Mac.
- A control socket that drops (the runner restarted) is not reopened until the Inspector reattaches; the 8 s timer covers it meanwhile.


## The App's Kept profile and its reset

### Goal

The desktop app opens a browser on the selected App's **Kept profile**, the one that App's Runs use, so the Inspector and Runs share its logins, and offers "Reset browser profile" to start signed out again ([#366](https://github.com/Aris-ngoy/qa-agent/issues/366), decided in [#346](https://github.com/Aris-ngoy/qa-agent/issues/346)). The runner side is [web-kept-profile.md](../devices/web-kept-profile.md).

### Plan summary

- **Every web connect names the App.** `connectRequestFor` adds the selected App's id as `appId` on web, so Connect, Restart, Run and the trust reconnect all open its Kept profile; with no App selected the runner uses `default`. A phone's connect is unchanged. Since the Inspector's session is now on the Run's App and profile, a Run adopts it instead of relaunching the browser.
- **Reset sits with the browsers, where the Viewport preset is chosen.** Each row of the picker's Browsers tab has a "Reset browser profile" button next to picking it. It resets that one browser's profile for the selected App. Rejected: one button for every browser's profile (a user signed in on Chrome rarely means to sign Edge out too), and a control in the top bar, which is for the session, not a browser that may be closed.
- **Confirm first; show the refusal where it was asked.** A danger dialog says whose logins go. While the browser has that profile open the runner answers 409 (disconnect first); the dialog stays open and shows the runner's own words, so the user can disconnect and try again. A reset that found no profile says there was nothing to reset.
- An attached browser (Attach by port) has no Kept profile and no reset.

### What shipped

- `connectRequestFor` (`devices/utils/session-app.ts`) sends `appId` on web.
- `resetBrowserProfile` in `devices/data/api/devices.ts` (`DELETE /devices/web/profiles` through `RunnerClient.resetWebProfile`), `useResetBrowserProfile` in `devices/hooks/usequery/use-devices.ts`.
- `resetProfileRequest`, `resetProfileConfirmation` and `resetProfileDone` in `devices/utils/web-device.ts`.
- `ResetProfileDialog` in `web-device-panels.tsx`, and a per-row action in the picker's device list. The Browsers tab no longer calls the profile throwaway.
- Tests: `devices/data/api/devices.test.ts` (the request, the default profile, a 409's message) with the desktop RPC mocked; the helpers in `web-device.test.ts`; `appId` in `session-app.test.ts`.

### How to verify

```bash
bun test apps/desktop/src/mainview/features/devices
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome (not run here: this sandbox has no macOS browser or desktop shell):

1. Select an App, platform Web, Google Chrome, Connect. Sign in to the App's site in the window. Disconnect and Connect again: still signed in, and `~/.yoqa/browser-profiles/<app id>/web-chrome/` exists.
2. Start a Run on it: the Run adopts the session (no new window) and is signed in.
3. While connected, Select device → Reset browser profile on Google Chrome → Reset: the dialog shows the runner's "Disconnect it before resetting the profile." and the folder stays.
4. Disconnect, reset again: a toast says it reset Google Chrome's profile for the App, the folder is gone, and the next connect starts signed out. Reset once more: "Nothing to reset".

### Follow-ups

- Switching App in the side menu while a web session is up retargets without reconnecting, so the browser stays on the previous App's profile until it reconnects; a Run reopens it on its own App's profile meanwhile.
- No desktop control for a Run's `profile: clean` yet; a Case Script's `profile: clean` asks for one.

## The Everyday browser

### Goal

Pick, enable and connect the user's own signed-in browser from the desktop app ([#372](https://github.com/Aris-ngoy/qa-agent/issues/372), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339), [ADR-0009](../adr/0009-everyday-browser-consent-attach.md)). The runner side (discovery, the 60 s Allow wait, the per-App warning) is [web-everyday-browser.md](../devices/web-everyday-browser.md). Vocabulary: **Everyday browser**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md).

### Plan summary

- **A tab of its own, in place of Attach by port.** The web picker's tabs are **Browsers** (the ones Yoqa launches on a Kept profile) and **Your browser** (one entry per installed browser's Everyday device, `web-<browser>-everyday`, from the same `GET /devices?platform=web`). Each shows **ready** or **remote debugging off**, as the runner lists it. Only a ready one can be picked; the Viewport choice applies to both tabs. Attach by port (`chromium-cdp-*`) leaves the desktop: the form is gone, and `browserDevices` drops such ids even if listed. The CLI keeps it. Rejected: mixing the Everyday entries into the Browsers list, where they would read as another launch.
- **Open the setting, never the pref.** An entry that is off has **Open the setting** and a line on what to turn on. It is a desktop RPC, `openRemoteDebuggingSetting({ browserId })`, that runs `open -a <App> chrome://inspect/#remote-debugging` (the app named from the id on the host side, so the webview cannot open arbitrary apps). The user flips the toggle; the picker rescans when the window regains focus, so the entry turns ready on return. macOS only: elsewhere the RPC says to open the page by hand.
- **The warning comes from the runner's 428.** Every connect (Connect, Restart, Run, the trust reconnect) goes through `connectAcceptingWarning`: on `EVERYDAY_WARNING_REQUIRED` it shows a dialog ("The agent will act in your signed-in <Browser>. It can read and change anything your accounts there can.", then the runner's own text), and Continue connects again with `acceptEverydayWarning: true`. The runner remembers it per App, so the desktop keeps no copy of its own. Cancel connects nothing and asks again next time. Rejected: a desktop-side "already warned" flag, which the CLI would not share.
- **Waiting is visible and cancellable.** While a connect to an Everyday browser is in flight, the top bar shows **Click Allow in <Browser>** with **Cancel**. Cancel aborts the `POST /devices/connect` (the client's `connectDevice` takes a `signal`), and the runner stops its wait on the request's abort. A Cancel, on the warning or the wait, shows no error toast (`isConnectCancelled`), including from a Run's connect. A Deny or a timeout is the usual error toast with the runner's message.
- **A one-time note after the first disconnect.** Yoqa never turns the toggle off, so the first disconnect from an Everyday browser adds a toast that remote debugging is still on and where to turn it off. Shown once per desktop install (`localStorage`), not per browser.

### What shipped

- `devices/utils/everyday-browser.ts`: `isEverydayDeviceId`, `everydayBrowserName`, `everydayEntries`, `allowPrompt`, `everydayWarningLine`, `connectAcceptingWarning`, `ConnectCancelledError` / `isConnectCancelled`, `takeDisconnectNote`. `browserDevices` (`web-device.ts`) leaves out Everyday and attach-by-port ids; `attachDeviceId` and `AttachByPortForm` are removed.
- `EverydayBrowserList` in `web-device-panels.tsx`, the **Your browser** tab in `select-device-modal.tsx`, and `EverydayWarningDialog` (`everyday-warning-dialog.tsx`).
- Session bar: `everydayWarning` and `waitingForAllow` in its state, the connect's `AbortController`, the Allow prompt with Cancel in `session-toolbar.tsx`, and the disconnect note. `useStartRun` stays quiet on a cancelled connect.
- `openRemoteDebuggingSetting` in `devices/data/api/devices.ts` and `useOpenRemoteDebuggingSetting`; the host side in `bun/features/everyday-browser` and `shared/rpc.ts`. `RunnerClient.connectDevice(request, { signal })`.

### How to verify

```bash
bun test apps/desktop/src/mainview/features/devices apps/desktop/src/bun/features/everyday-browser
bun run lint:ci && bun run test && bun run check
```

The tests cover: ready and off entries from the runner's list, `chromium-cdp-*` left out of the picker, the RPC called with the browser's id and `open -a Dia chrome://inspect/#remote-debugging` on the host, the warning asked once per App against a fake runner that remembers acceptances, and Cancel aborting the connect request.

By hand on a Mac with Dia (not run here: this sandbox has no macOS browser or desktop shell):

1. Dia open, remote debugging off. Top bar → Web → Select device → **Your browser**: Dia reads **remote debugging off**. **Open the setting**: Dia opens `chrome://inspect/#remote-debugging`. Turn the toggle on and come back: Dia reads **ready**.
2. Pick Dia, Connect: the warning names Dia. **Cancel** connects nothing and shows no error. Connect again → **Continue**: the bar reads **Click Allow in Dia**. Click Allow in Dia: a new Dia window opens and the bar is connected. Connect Inspector: the page shows and picks.
3. Disconnect: Yoqa's window closes, and a note says remote debugging is still on in Dia. Connect again: no warning this time; **Cancel** while it waits stops it, and Deny shows "Remote debugging was denied in Dia".
4. Switch to another App and Connect: the warning shows once for it.

### Follow-ups

- The by-hand check above on Dia.
- Windows: no way to open the setting from the desktop ([#354](https://github.com/Aris-ngoy/qa-agent/issues/354)).

## The browser profile next to the preset

### Goal

Show which browser profile a web session or Run used, next to its Viewport preset ([#379](https://github.com/Aris-ngoy/qa-agent/issues/379), decided in [#349](https://github.com/Aris-ngoy/qa-agent/issues/349) under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). The runner already sent the Everyday browser's profile name for a session and a Run, but the desktop showed it nowhere, so a session in the user's Work profile looked like one in Personal.

### Plan summary

- **The session bar names the profile the runner read.** An Everyday session reads `Dia · desktop · profile Work`, from the Active Session's `browserProfileName`. When the runner could not read it (null), the bar shows `Dia · desktop`. A launched browser adds nothing: its Kept profile follows the selected App, which the bar already names. Rejected: a separate chip for the profile, which would crowd a bar that already truncates.
- **A Run's line says the same, in the report's words.** The web line under a Run's title gains `profile Work` from the Run's `browserProfileName` (lowercase, as the report's Browser row writes it), and `clean profile` when the Run's `profile` is `clean`. A Kept-profile Run's line is unchanged (`Profile kept`), and a phone's Run still shows no line.

### What shipped

- `withViewport` (`devices/utils/web-device.ts`) takes the session's profile name; `session-toolbar.tsx` passes `active.browserProfileName`.
- `formatRunEnvironment` (`runs/utils/labels.ts`) words the profile through `formatRunProfile`: the Everyday profile's name first, then a clean profile, then the stored one.

### How to verify

```bash
bun test apps/desktop/src/mainview/features/devices/utils/web-device.test.ts apps/desktop/src/mainview/features/runs/utils/labels.test.ts
bun run lint:ci && bun run test && bun run check
```

The tests cover the bar label for an Everyday session with a profile name, with a null one, and a launched browser, and the Run line for an Everyday Run with a profile, a clean Run, a kept Run and a phone Run.

By hand on a Mac with Dia (not run here): connect **Your browser** → Dia with Dia's Work profile in front of the default; the bar reads `Web · Dia · desktop · profile <the default profile's name>` (Yoqa's window opens in the default profile). Run a case there: its details read `Browser Everyday Dia … · Viewport desktop (1280×800) · profile <name> · Lane Direct`. Run with profile clean on Google Chrome: the line ends `· clean profile · Lane Direct`.

### Follow-ups

None.

## Unverified browsers in the picker

### Goal

Show which browser rows nobody has checked by hand yet: Arc, Opera and Vivaldi, in both tabs (#378). The runner side is in [web-supported-browsers.md](../devices/web-supported-browsers.md#unverified-arc-opera-and-vivaldi).

### Plan summary

- **One state line per row**, as #349 decided: the state, then `unverified` (`not running · unverified`, `remote debugging off · unverified`), from the Device's `verified: false`. `formatDeviceState` in `@yoqa/runner-client` words it, so the CLI's `yoqa devices web` reads the same. Rejected: an icon or badge per browser.
- **Open the setting for an unverified browser** still opens `chrome://inspect/#remote-debugging` in that app, but its line adds how to open the page by hand if it doesn't load (Opera may want `opera://inspect`).

### What shipped

- `toDeviceRow` sets the Browsers row's state from `formatDeviceState`; `EverydayEntry` carries `verified`, and the Your browser list uses `everydayStateLine` and `turnOnHint`.
- The host's Open the setting names the app from `WEB_BROWSERS`, so Arc, Opera and Vivaldi open too, and the webview still cannot name an app outside the list.
- The empty-list messages name all eight browsers.

### How to verify

```bash
bun test apps/desktop/src/mainview/features/devices/utils/everyday-browser.test.ts apps/desktop/src/bun/features/everyday-browser/index.test.ts packages/runner-client/src/web-browsers.test.ts
```

By hand on a Mac with Arc, Opera or Vivaldi (not run here): Web → Select device. The Browsers row reads `Not Running · Unverified` and the Your browser row `Remote Debugging Off · Unverified`, with the line about opening the page by hand.

### Follow-ups

- Drop `unverified` per browser once its hand check passes (`verified: true` in `WEB_BROWSERS`).
