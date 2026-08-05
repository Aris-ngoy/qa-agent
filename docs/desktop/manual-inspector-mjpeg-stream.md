# Manual Inspector — MJPEG stream + live control

## Goal

Make the Manual Inspector live feed as fast as Appium allows on **all platforms** (iOS sim, real iOS, Android), and add optional **live device control** (drag on the mirror), inspired by [serve-sim](https://github.com/EvanBacon/serve-sim)’s stream + control split—without depending on serve-sim or `simctl`.

## Plan summary

- **Video:** Enable Appium’s built-in MJPEG broadcaster (`appium:mjpegServerPort` + settings) for XCUITest and UiAutomator2; proxy it through the runner at `GET /stream.mjpeg`.
- **Control:** Bun WebSocket `WS /ws/control` with JSON pointer `begin` / `move` / `end` (0–1000 coords), coalesced moves, mutex vs script/`POST /action`.
- **Persistence:** Split `captureFrame()` (no disk) from `screenshot()` (persists). Live feed never writes `~/.yoqa/runs/screenshots/`.
- **Fallback:** If MJPEG is unreachable after connect, Inspector polls `GET /screenshot/image` (~250ms) and shows a **Poll** badge.
- Rejected: vendoring serve-sim / Swift `simctl io` helper / H.264 (iOS-sim-only).

## What shipped

**Runner**

- Allocates a free MJPEG port on connect; sets `mjpegServerPort` (not `mjpegScreenshotUrl`, which needs optional `mjpeg-consumer`)
- Applies settings: framerate **60** (sim / Android) or **15** (physical iOS), JPEG quality 35/25, scaling 50/40
- `appium:newCommandTimeout` **3600** so interactive Inspector sessions do not idle-out under WDA load
- Physical iOS also sets `waitForIdleTimeout: 0` to reduce WDA work under stream
- `GET /stream.mjpeg` proxies the Appium MJPEG body
- `GET /screenshot/image` uses in-memory `captureFrame()`
- `WS /ws/control` for live pointer; action gate blocks interleaving with scripts
- Live gestures are **buffered** locally and flushed as one tap/drag on pointer-up (WDA cannot stream mid-gesture `performActions`)
- Active device response includes `mjpegPort`, `streamReady`, `streamUrl`

**Client (`@yoqa/runner-client`)**

- `getStreamMjpegUrl()`, `getControlWsUrl()`
- Extended `ActiveDeviceResponse` + `controlMessageSchema`

**Desktop Inspector**

- Primary feed: `<img src="/stream.mjpeg">` (no 150ms PNG poll)
- **No automatic page-source while MJPEG is idle** — continuous source+stream dual-loads WDA and kills the session
- **Cached Select Mode (Maestro-like):** tree warms when Live control is off / after commands / Refresh tree; clicks and hover hit-test the cache locally. Refresh still uses `GET /screen?pauseMjpeg=1` then remounts `/stream.mjpeg` — never per-click blocking under a warm cache
- Live control still uses the continuous MJPEG feed (~60 FPS) without page-source
- Tree also refreshes after script/commands (same pause+remount under Stream) and on the poll feed
- **Live control** checkbox: pointer drag → WS; script select/menu when off
- **Stream** vs **Poll** badge
- **Restart session** in the toolbar: disconnect + reconnect and remount the MJPEG URL (manual only)
- On unexpected session death: clear the feed and toast to use **Restart session** or **Connect** — no auto-reconnect
- Disconnect aborts open MJPEG proxies and time-bounds `deleteSession` so WebDriverAgentRunner can exit instead of hanging forever

## How to verify

1. Connect an iOS Simulator (or real iOS / Android) in Inspector → badge **Stream**; idle connect does not grow `~/.yoqa/runs/screenshots/`.
2. On a real iPhone, the live stream should stay up for minutes with no continuous tree polling in the background.
3. Disable **Live control** → wait for tree warm (or **Refresh tree**) → hover then click a button/word: highlight + menu with `tap (id)` / `tap (label)` without per-click “Reading screen…”. Stream remounts only when the tree actually refreshes.
4. Enable **Live control** → drag/swipe on the mirror (no page-source); disable → select again for commands.
5. Explicit screenshot / script report still persists files.
6. Disconnect closes the stream and control socket cleanly.
7. If MJPEG fails to probe, badge shows **Poll** and the feed still updates.
8. If WDA dies, Inspector stops the feed and prompts **Restart session** (no automatic reconnect).

## Follow-ups

- Img `onError` auto-fallback from MJPEG → poll mid-session
- Dedicated **type by id** command chip in the element menu
- Binary WS pointer protocol (serve-sim-style) if JSON coalescing is not enough
- Hardware home / rotate over the control channel
- Tune framerate/quality per platform from Settings
- Further soften physical-iOS MJPEG (quality / scaling) if WDA still flakes