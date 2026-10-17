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

- Device picker (`select-device-modal.tsx`, `web-device-panels.tsx`): Web title, the Viewport choice, the Browsers list (with a note that Yoqa opens its own window on a throwaway profile), and the Attach-by-port form (react-hook-form, port 1–65535).
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
