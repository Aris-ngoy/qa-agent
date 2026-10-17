# Web: Viewport presets

## Goal

Make a web page's size reproducible, and let a React Native Web build behave as it does on a phone ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301), stories 8–10 and 42). A connect takes a **Viewport preset**, fixed for the Device Session's life and stored on the Run. `desktop` (1280×800) is the default. `mobile` (390×844) also sets a mobile user agent and device scale factor and turns on touch, so a tap is a touch tap and a swipe a real touch swipe. Ticket [#310](https://github.com/Aris-ngoy/qa-agent/issues/310). Vocabulary: **Viewport preset**, **Device Session**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **Two named presets.** `desktop` is 1280×800 at 1 screenshot pixel per CSS pixel, so a Retina display does not double the screenshot. `mobile` is an iPhone 14 screen: 390×844 at 3×, with Safari's iPhone user agent and touch emulation. The table (`VIEWPORT_PRESETS`) lives in `@yoqa/runner-client`, so the CLI and the report can name a preset with its size.
- **Emulated on every page.** The lane applies the preset (`Emulation.setDeviceMetricsOverride`, plus `setTouchEmulationEnabled` and `setUserAgentOverride` on mobile) to each page it attaches: the first page, a popup it follows, and terminate-app's blank page. The window's own size no longer matters, for launched and attached browsers alike.
- **The preset is the coordinate mapping.** 0–1000 maps onto the preset's CSS size, and `getWindowSize` answers it, instead of reading `Page.getLayoutMetrics` per Action. On a mobile page with no `<meta name=viewport>`, the layout viewport is 980 px wide, but the screenshot and input are in the preset's size, so mapping from the preset is what keeps them aligned. This replaces "coordinates follow the page" from [web-popups.md](./web-popups.md): a popup is now at the session's preset, not its own window size.
- **One pointer.** Tap, drag, swipe and the Inspector's live pointer press, move and release one pointer: the left mouse button on desktop, a finger (`Input.dispatchTouchEvent`) on mobile. On mobile a swipe is that finger moving from start to end over its duration (400 ms by default, as on Android), so the page scrolls itself. On desktop a swipe stays one wheel scroll.
- **Stored on the Run.** The Run stores the session's preset (an additive `viewport` column, null on other platforms) next to its browser. A Run adopts the Active Session at whatever preset it was connected with; a Run that connects itself is desktop.
- Rejected: free-form sizes (`--viewport 414x896`), which make runs harder to compare and the report harder to read; reading the viewport from the page under emulation (see above); and mouse-to-touch conversion (`Emulation.setEmitTouchEventsForMouse`), which gives no control over a swipe's path.

## What shipped

- `@yoqa/runner-client`: `viewportPresetSchema` (`desktop | mobile`), `VIEWPORT_PRESETS` and `formatViewportPreset`. The connect request, the Active Session response and the Run carry an optional `viewport`. The report gains a Viewport row (`mobile (390×844)`) next to Browser in Markdown, the GitHub summary and HTML.
- Runner: `SessionOptions.viewport` and `DeviceSession.viewport`. `POST /devices/connect` passes the preset to the lane, answers 400 `viewport must be desktop or mobile` for any other name, and names the preset in the response and `GET /devices/active`. `executeRun` stores it on the Run.
- Web Direct lane: preset emulation on each attached page, the preset as the coordinate mapping, and touch tap, swipe, drag and live pointer under mobile.
- CLI: `yoqa devices connect <web device> --viewport mobile` (any case), for installed and attached browsers. `connect` and `devices active` print `viewport mobile (390×844)`. `--viewport` on a phone fails before anything connects.
- Tests: Lane contract cases for both presets (corner and screenshot-space mapping, window size, screenshot size), the mobile user agent and touch, touch taps and touch swipes, and a popup taking the preset. A mobile-preset harness runs every shared contract case. The faked CDP endpoint models device emulation and records touches; a touch that ends where it started is a click. Plus the HTTP connect, a Run storing the preset, the report rows, and the CLI option.

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "web"
bun test services/runner/src/domains/devices/active-session.test.ts -t "Viewport"
bun test services/runner/src/domains/runs/web-run.test.ts packages/cli/src/devices-connect-viewport.test.ts
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome:

```bash
yoqa devices connect web-chrome --viewport mobile   # connected web web-chrome lane direct viewport mobile (390×844)
yoqa action open-url --url https://m.example.com
yoqa screenshot /tmp/phone.png                      # 1170×2532, a phone layout
yoqa action swipe --x 500 --y 800 --x2 500 --y2 200 # the page scrolls under the finger
yoqa runs create <app> --cases 1 --device web-chrome
yoqa runs report <run>                              # | Viewport | mobile (390×844) |
```

This has not been run against a real browser here (no macOS browser in this sandbox).

## Follow-ups

- `yoqa runs create` has no `--viewport`: a Run that opens its own session is desktop. Connect first to run at another preset.
- Done in [#311](https://github.com/Aris-ngoy/qa-agent/issues/311): the desktop picker's preset choice ([web-devices.md](../desktop/web-devices.md)). The skill docs are [#312](https://github.com/Aris-ngoy/qa-agent/issues/312).
- More presets (a tablet, an Android phone) are one entry each in `VIEWPORT_PRESETS`.
