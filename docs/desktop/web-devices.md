# Desktop: web devices, Inspector and Runs

## Goal

Bring web into the desktop app ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301), stories 37–40; ticket [#311](https://github.com/Aris-ngoy/qa-agent/issues/311)). Installed browsers sit in the device picker next to simulators and phones. A connect names a **Viewport preset**, and a Chromium the user started can be attached by its port. The Inspector shows and drives the page through Screenshot Poll and reads the web Screen. The Runs panel starts Runs on a web device, and a Run's details name its browser, viewport and Lane. iOS and Android flows stay as they were. Vocabulary: **Browser device**, **Viewport preset**, **Frame Feed**, **Active Session**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **Web is a third platform in the top bar.** The session bar's platform select offers Web. Its picker is shaped for browsers, not phones: a **Browsers** tab (installed Chrome, Edge, Brave and Chromium, from `GET /devices?platform=web`, running or not) and an **Attach by port** tab. Rejected: putting browsers under the phone tabs ("Local Devices" / "Simulators"), which fit neither.
- **The preset is picked with the device.** A Desktop / Mobile choice above the tabs (sizes from `VIEWPORT_PRESETS`) is stored on the picked device and sent as `viewport` on connect. It is fixed for the session's life, so changing it means reconnecting. Restart reconnects at the session's own preset, and the remembered device keeps its preset across launches. Rejected: a separate preset control in the top bar, which would suggest it can change while connected.
- **Attach names a port, never a scan.** The port becomes `chromium-cdp-<port>`. Such a device is never listed, so the bar names it from its id ("Chromium on port 9222"). The tab repeats how to start the browser (`--remote-debugging-port`, a non-default `--user-data-dir`).
- **The Inspector already polled.** It chose the Frame Feed from `streamReady` and a stream URL, so a web session (`streamState: none`) was already Screenshot Poll with the plain "Connected — screenshot poll" toast. That choice is now one tested function, `feedModeFor`, which polls whenever the runner says there is no Stream. The frame is shaped by the preset (a page, not a rounded phone), and the empty state no longer says "stream".
- **Runs read what the Run stored.** A web Run's details gain one line, `Browser Google Chrome 141.0 · Viewport mobile (390×844) · Lane Direct`, built from the Run's `browser`, `viewport` and `lane`. A phone's Run shows no such line, so its details are unchanged. The step screenshot frame takes the preset's shape on web.

## What shipped

- Device picker (`select-device-modal.tsx`, `web-device-panels.tsx`): Web title, the Viewport choice, the Browsers list (with a note that Yoqa opens its own window on the App's Kept profile; see [below](#the-apps-kept-profile-and-its-reset)), and the Attach-by-port form (react-hook-form, port 1–65535).
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
4. Start Chrome with `--remote-debugging-port=9222 --user-data-dir="$(mktemp -d)"`. In the picker, Attach by port → 9222 → Attach → Connect. The bar reads `Chromium on port 9222`. Disconnect leaves that Chrome open.
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
