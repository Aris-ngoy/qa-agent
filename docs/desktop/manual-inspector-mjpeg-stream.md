# Manual Inspector — live feed (poll transport)

## Goal

Make the Manual Inspector live feed as fast as `agent-device` allows on **all platforms**
(iOS sim, real iOS, Android), with optional **live device control** (drag on the mirror) —
without depending on a video broadcaster.

> History: this doc previously described an Appium MJPEG broadcaster (`mjpegServerPort`).
> That backend is gone with Appium (see [Remove Appium](../devices/remove-appium.md)).
> `GET /stream.mjpeg` now returns `410`; the feed is a fast screenshot poll.

## Plan summary

- **Frames:** `GET /screenshot/image` backed by `agent-device screenshot --no-stabilize`
  (low-latency capture loop; persisted screenshots keep full quality). Server coalesces
  concurrent polls within a 150ms TTL so N viewers share one `agent-device` call.
- **Client:** polls at ~180ms; frame and tree requests fly on independent locks so the feed
  never blocks selection. Polling pauses while a script runs; tree warms 500ms after connect.
- **Control:** Bun WebSocket `WS /ws/control` with JSON pointer `begin` / `move` / `end`
  (0–1000 coords). Live gestures buffer locally and flush as one tap/swipe on pointer-up.
- **Persistence:** live frames are in-memory only and never write `~/.yoqa/runs/screenshots/`.
- **Fallback/degraded:** none needed — poll is the only transport. If the session drops,
  Inspector clears the feed and prompts **Restart session** (no auto-reconnect).
- Rejected: re-adding an MJPEG/H.264 broadcaster (agent-device owns recording via `record`);
  per-frame JPEG downscale (kept PNG so the 0–1000 grid maps 1:1; revisit if 180ms proves slow).

## What shipped

**Runner**

- `captureFrame()` passes `--no-stabilize` and shares one in-flight screenshot across
  concurrent callers within a 150ms TTL (`services/runner/src/domains/devices/session.ts`).
- `GET /screenshot/image` stays the live-frame endpoint (`Cache-Control: no-store`).
- `GET /stream.mjpeg` stays `410` with a pointer to poll + `record`.
- `WS /ws/control` unchanged: buffered tap/swipe on pointer-up, action gate blocks
  interleaving with scripts.

**Client (`@yoqa/runner-client`)**

- `getScreenshotImageUrl()`, `fetchScreenshotBytes()`, `getControlWsUrl()`.
- `getStreamMjpegUrl()` kept as a deprecated pointer (runner returns `410`).
- `getScreen()` keeps the accepted-but-ignored `pauseMjpeg` option for wire compat.

**Desktop Inspector**

- Single **Poll** badge; frame poll ~180ms, tree refresh 8s, both paused while a script runs.
- **Cached Select Mode** unchanged: clicks/hover hit-test the cached cleaned tree locally.
- **Live control** checkbox: pointer drag → WS; selection menu when off.
- **Restart session** in the toolbar: disconnect + reconnect + resume poll.

## How to verify

1. Connect a device in Inspector → badge **Poll**; idle session does not grow
   `~/.yoqa/runs/screenshots/`.
2. Disable **Live control** → hover then click a control: highlight + menu without
   per-click “Reading screen…”.
3. Enable **Live control** → drag on the mirror (no tree fetch); disable → select again.
4. Run a script → feed pauses during the run, resumes after.
5. If the session dies, Inspector prompts **Restart session** (no auto-reconnect).

## Follow-ups

- Img `onError` retry with backoff mid-session.
- Optional JPEG/scale query (`?format=jpeg&w=…`) if PNG poll proves slow on real devices.
- Binary WS pointer protocol if JSON proves laggy.
- Hardware home / rotate over the control channel (today: `yoqa action home`, no rotate).
- Tune poll interval / frame TTL per platform from Settings.
