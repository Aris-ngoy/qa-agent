# Web screencast Frame Feed over /stream.mjpeg

## Goal

Stop the web Inspector flickering on Retina Macs under a Viewport preset ([#359](https://github.com/Aris-ngoy/qa-agent/issues/359), decided in [#347](https://github.com/Aris-ngoy/qa-agent/issues/347) under map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). A web session had no Stream, so the Inspector polled `/screenshot/image` every 250 ms. Under device emulation each `Page.captureScreenshot` re-emulates and resizes the browser's view and then restores it, and the user sees every step. The fix is a `Page.startScreencast` **Frame Feed** served on `/stream.mjpeg`, as iOS and Android already have. Background: `docs/research/web-inspector-flicker.md` on the `research/web-inspector-flicker` branch. Vocabulary: **Frame Feed**, **Viewport preset**, **Screen** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **A screencast while someone watches.** The web Direct lane serves a local MJPEG server, the session's `stream`. The runner proxies it on `/stream.mjpeg` like any other Stream. The page screencasts only while that server has a watcher. The first watcher starts `Page.startScreencast`, and the last one leaving stops it. Quitting the session stops it too, and so does a Dead Session.
- **Sized by Chromium, checked from `metadata`.** The screencast asks for JPEG at quality 70, `everyNthFrame: 2` (about 30 fps at 60 Hz), with `maxWidth`/`maxHeight` at the preset's CSS size. Chromium paints in the display's pixels (2× on Retina) and scales each frame down to fit, so a frame is the preset's size at both presets.
  - A frame counts only when its `metadata` shows the preset's viewport: `deviceWidth`×`deviceHeight` is the preset and `offsetTop` is 0. That keeps the Inspector's 0–1000 on the Screen's 0–1000.
  - After `startScreencast`, Chromium paints the whole window's view until the emulation is set again. So the lane sets `Emulation.setDeviceMetricsOverride` right after starting. Any frame that still does not show the preset is dropped and the emulation is set again, at most every 500 ms. Re-applying the emulation does not flicker (measured in the research).
- **Rejected: cropping frames.** The runner has no JPEG codec (Bun 1.2 has no image API, and the runner has no image dependency). Decoding and re-encoding about 30 frames a second in the runner would also cost more than asking Chromium for the right frame.
- **The Stream follows the page.** When a popup takes the session over, or the session goes back to the opener, or terminate-app swaps in a blank page, the screencast moves to the new page.
- **A tree read leaves the web Stream up.** A phone's device tool cannot stream and read its tree at once, so `/screen` pauses MJPEG proxies by default. CDP serves both. A web `LiveStream` says `survivesTreeRead`, and `getScreen` then leaves its watchers alone. The desktop Inspector does not ask for the pause on web (`treeReadPausesStream`), and it keeps the 8 s tree refresh on the Stream (now a backstop: the screen-changed signal re-reads it, [web-devices.md](../desktop/web-devices.md#keeping-the-hover-tree-fresh)).
- **Single shots stay.** `captureFrame` and `screenshot` still use `Page.captureScreenshot` (PNG), for `/screenshot/image`, Run step screenshots and `yoqa screenshot`. One flash per shot is acceptable there.

## What shipped

- **`mjpeg-server.ts`** (new): a local MJPEG server that frames are pushed into. It calls `onWatched` and `onUnwatched` as the first watcher arrives and the last one leaves. It sends a new watcher the newest frame and resends that frame every second while nothing changes. A watcher that falls behind skips frames instead of queueing them. `ios-device-preview.ts` now uses its `mjpegPart`.
- **`web-direct-lane.ts`:**
  - The session's `stream` is that server, with `survivesTreeRead`.
  - The lane starts, stops, acks and follows the screencast, and `showsPreset` checks each frame's metadata.
  - Quit and a Dead Session stop the server.
- **`cdp-client.ts`:** types for `Page.startScreencast`, `Page.stopScreencast`, `Page.screencastFrameAck` and the frame's metadata.
- **`interfaces/http/session.ts`:** `/stream.mjpeg` aborts its upstream fetch when the client's request aborts. Before this, a fetch whose body was only cancelled kept its socket, so a Lane never saw its last watcher leave.
- **`interaction.ts`:** `getScreen` skips the MJPEG pause for a stream that survives a tree read.
- **`fake-cdp.ts`:** screencasts as Chromium does. Frames are JPEGs in the display's pixels, scaled to fit the max size. Each next frame waits for the previous ack. Until the emulation is set again, a frame shows the window's view. The fake also has `fakeJpeg`, `jpegSize` and `readMjpegFrames` for tests.
- **Desktop Inspector:** a web session reports `streamState: "ready"`, so `feedModeFor` picks the Stream, and the 250 ms `/screenshot/image` poll does not run while it is up. `treeReadPausesStream` keeps the tree refresh running without remounting the Stream.
- **Tests:**
  - Lane tests: the Stream is JPEG frames at the preset's size; nothing screencasts until someone watches; every frame is acked; frames of the window's view are not served.
  - Lane tests: the screencast stops when the last watcher leaves and on quit; it follows a popup; a tree read does not pause it.
  - A Lane contract case per preset on a 2× display.
  - Runner tests through a served `/stream.mjpeg`: frames for a mobile session, a stop when the Inspector hangs up, and a stop on disconnect.

## How to verify

- `bun test services/runner/src/domains/devices/web-direct-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts services/runner/src/domains/devices/active-session.test.ts apps/desktop/src/mainview/features/inspector/utils/inspect-session.test.ts`
- **By hand on a Mac** (not done in this change, which was built on Linux):
  1. Connect a web device at the mobile preset.
  2. Open the Inspector. The badge reads "Stream".
  3. Animate something on the page. The browser window shows no 1.5× or torn frames.
  4. Close the Inspector, and the screencast stops: `chrome://inspect` or the runner log shows no more frames.

## Follow-ups

- **Check by hand on a Mac** that the mobile preset no longer flickers (acceptance criterion of #359).
- **Pinch zoom.** Frames are matched on size and `offsetTop` only. A page pinch-zoomed by the user (`pageScaleFactor` above 1) is still served, and its 0–1000 then covers the zoomed view.
- Done: [ADR-0011](../adr/0011-web-testing-on-macos.md) records the screencast and supersedes ADR-0007's Screenshot Poll.
- A fresher hover tree is [#362](https://github.com/Aris-ngoy/qa-agent/issues/362).
