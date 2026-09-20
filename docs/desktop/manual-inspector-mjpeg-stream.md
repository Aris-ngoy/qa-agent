# Manual Inspector — live feed (poll transport)

## Goal

Make the Manual Inspector live feed as fast as `agent-device` allows on **all platforms**
(iOS sim, real iOS, Android), with optional **live device control** (drag on the mirror) —
without depending on a video broadcaster.

> History: this doc previously described an Appium MJPEG broadcaster (`mjpegServerPort`).
> That backend is gone with Appium (see [Remove Appium](../devices/remove-appium.md)).
> `GET /stream.mjpeg` now returns `410`; the feed is a fast screenshot poll.

## Plan summary

- **Frames:** `GET /screenshot/stream` — a `multipart/x-mixed-replace` stream of PNG
  frames rendered straight into `<img>`, backed by `agent-device screenshot --no-stabilize`
  (low-latency capture loop; persisted screenshots keep full quality). The server pumps
  fresh captures back-to-back (~1 frame/s on sim — the `simctl` capture ceiling), so
  delivery tracks the fastest the backend can capture with no per-frame HTTP overhead.
- **Fallback:** if the stream errors, the Inspector degrades to `GET /screenshot/image`
  poll at 500ms (server coalesces concurrent polls within a 150ms TTL). A **Poll** badge
  marks degraded mode; **Live** marks the stream.
- **Client:** frame delivery and tree refreshes are independent, so the feed never blocks
  selection. Both pause while a script runs; tree warms 500ms after connect.
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
  concurrent callers within a 150ms TTL (`services/runner/src/domains/devices/session.ts`);
  stream pumps pass `{ fresh: true }` to pace on real captures.
- `GET /screenshot/stream` pumps the multipart feed until abort or session death
  (`domains/devices/feed.ts`); no session returns `410 Device session ended`.
- `GET /screenshot/image` stays the one-shot endpoint (`Cache-Control: no-store`).
- `GET /stream.mjpeg` stays `410` with a pointer to the stream + `record`.
- `WS /ws/control` returns machine-readable error codes (`NO_SESSION`, `HELD_BY_RUN`,
  `INVALID_JSON`, `INVALID_MESSAGE`, `POINTER_FAILED`) with the detail attached.

**Client (`@yoqa/runner-client`)**

- `getScreenshotImageUrl()`, `fetchScreenshotBytes()`, `getControlWsUrl()`.
- `getStreamMjpegUrl()` kept as a deprecated pointer (runner returns `410`).
- `getScreen()` keeps the accepted-but-ignored `pauseMjpeg` option for wire compat.

**Desktop Inspector**

- **Live** badge on the multipart stream, **Poll** badge on degraded poll; tree refresh 8s,
  paused while a script runs.
- **Cached Select Mode** unchanged: clicks/hover hit-test the cached cleaned tree locally.
- **Live control** checkbox: pointer drag → WS; selection menu when off. Pointer failures
  toast with the server detail (previously swallowed); dropped sockets reconnect with
  backoff (3 tries) before toggling off.
- **Restart session** in the toolbar: disconnect + reconnect + resume stream.

## How to verify

1. Connect a device in Inspector → badge **Live**; idle session does not grow
   `~/.yoqa/runs/screenshots/`. Frames arrive ~1/s on sim (capture ceiling).
2. Break the stream (disconnect the device) → badge flips to **Poll** and frames keep
   coming at the degraded rate.
3. Disable **Live control** → hover then click a control: highlight + menu without
   per-click “Reading screen…”.
4. Enable **Live control** → drag on the mirror moves content (no tree fetch);
   disable → select again. With the device unplugged mid-drag, a toast names the
   failure instead of silence.
5. Run a script → feed pauses during the run, resumes after.
6. If the session dies, Inspector prompts **Restart session** (no auto-reconnect).

## Follow-ups

- Img `onError` retry with backoff mid-session.
- Optional JPEG/scale query (`?format=jpeg&w=…`) if PNG poll proves slow on real devices.
- Binary WS pointer protocol if JSON proves laggy.
- Hardware home / rotate over the control channel (today: `yoqa action home`, no rotate).
- Tune poll interval / frame TTL per platform from Settings.
