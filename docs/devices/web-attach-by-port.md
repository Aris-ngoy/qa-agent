# Web: attach to a user-started Chromium by port

## Goal

Ship the first working slice of web support ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). A user starts Chrome, Edge or Brave with `--remote-debugging-port=9222` and a non-default `--user-data-dir`, then runs `yoqa devices connect chromium-cdp-9222`. After that, `yoqa screenshot`, `yoqa action tap --x --y`, `yoqa action input` and `yoqa action open-url` work against the page, on the same 0–1000 coordinate system, measured on the page viewport. Ticket [#303](https://github.com/Aris-ngoy/qa-agent/issues/303). Vocabulary: **Lane**, **Device Session**, **Browser device**, **Dead Session**, **Frame Feed** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **`web` is a platform and `browser` a device kind**, both added to the shared schemas. Old clients and saved rows still parse.
- **The Lane stays `direct`** (ADR-0005). `web` is a new Direct device class with one implementation, `cdp`, and its own opt-in variable (`YOQA_DIRECT_WEB`) like the other classes.
- **Our own CDP client** (`cdp-client.ts`) over Bun's WebSocket: typed `send`, event `on`, and `close`, covering only the commands the lane sends. Rejected: Puppeteer or Playwright, which would add a large dependency and a driver layer.
- **Attach is by an explicit port.** The device id `chromium-cdp-<port>` names it, and ports are never scanned. `/json/version` on that port gives the browser's socket. If nothing there speaks CDP, the connect fails. The message names `--remote-debugging-port` and the non-default `--user-data-dir` that Chrome 136+ requires.
- **One page.** The session drives the browser's first page (or opens a blank one) and brings it to the front, because a background tab never paints a screenshot.
- **Viewport coordinates.** 0–1000 maps to the page viewport's CSS pixels (`Page.getLayoutMetrics`), read on each gesture because the user can resize the window. The screenshot is `Page.captureScreenshot` of that viewport in device pixels, so window and screenshot space convert the same way.
- **Dead Session.** The socket closing (the browser quit) or the page detaching (the tab closed) ends the session once, through the existing `onSessionDead` path. Disconnecting only closes the socket and leaves the browser open.
- **Screen.** This slice reads named accessibility nodes and their border boxes into the JSON the existing Screen cleaner reads, so the Lane contract's tree case passes. The proper web Screen cleaner and `--full` raw tree are [#304](https://github.com/Aris-ngoy/qa-agent/issues/304).
- Rejected for this slice: listing installed browsers (attach has nothing to list), swipe/drag/alert/lifecycle (#305), and a Web URL on the App (#309).

## What shipped

- **Schemas** (`@yoqa/runner-client`): `devicePlatformSchema` gains `web` and `deviceKindSchema` gains `browser`. `appStartTarget` and `startTargetRequest` answer "no start target" on web.
- **Runner**
  - `cdp-client.ts`: the CDP client. A closed socket rejects every pending and later command with `CdpClosedError`. A command the browser leaves unanswered times out after 30 s without closing the socket.
  - `chromium-attach.ts`: `attachPortOf`, `browserSocketUrl` and `NoCdpEndpointError`.
  - `web-direct-lane.ts`: `createWebDirectSession`.
    - tap: mouse move, press, release; a long press holds for the duration.
    - input: `Input.insertText`; a newline presses Enter.
    - open-url: `Page.navigate`; a load error fails the Action.
    - Screenshot Poll (`stream: null`) and no `startRecording`. Swipe, drag, alerts and app lifecycle reject with "not available on the web Direct lane yet".
  - `direct-lane.ts` / `select-lane.ts` / `open-session.ts` route `web` to it.
  - `listDevices("web")` is empty: attach is by port.
  - Builds refuse to install on web.
- **Lane contract suite**: `webCdpLane` in `lane-harnesses.ts` opens the real lane against `fake-cdp.ts`, a local server that answers `/json/version` and speaks CDP over a WebSocket. It passes every contract case.
- **CLI**: `yoqa devices connect chromium-cdp-<port>` infers `--platform web`; other ids still need `--platform`. `yoqa devices web` exists, with an empty list for now. `yoqa benchmark` refuses web.
- **Desktop**: compiles with the wider platform type (labels, run glyph, picker copy). The session bar still offers iOS and Android only.
- **Docs**: ADR-0007, and `CONTEXT.md` (tagline, Device Session, Lane, Dead Session, new **Browser device**).

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "Web Direct"
bun test services/runner/src/domains/devices/web-direct-lane.test.ts packages/cli/src/platform.test.ts
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$(mktemp -d)" https://example.com &
yoqa devices connect chromium-cdp-9222        # connected web chromium-cdp-9222 lane direct
yoqa screenshot /tmp/page.png                 # the viewport only, no tabs or address bar
yoqa action tap --x 500 --y 500               # clicks the viewport's centre
yoqa action open-url --url https://example.org
yoqa devices connect chromium-cdp-9333        # fails: names --remote-debugging-port and --user-data-dir
```

Quit Chrome while connected: the next `yoqa screenshot` fails because the session has ended.

## Follow-ups

- [#304](https://github.com/Aris-ngoy/qa-agent/issues/304): the web Screen cleaner and the raw `--full` tree, replacing this slice's interim tree read.
- [#305](https://github.com/Aris-ngoy/qa-agent/issues/305): swipe, drag, alert and app lifecycle. [#306](https://github.com/Aris-ngoy/qa-agent/issues/306): follow popups instead of ending on a closed page.
- [#308](https://github.com/Aris-ngoy/qa-agent/issues/308): installed browsers in `yoqa devices web`, launched by Yoqa. [#310](https://github.com/Aris-ngoy/qa-agent/issues/310): viewport presets and a `--port` connect option.
- [#309](https://github.com/Aris-ngoy/qa-agent/issues/309): Web URL on the App and Runs on web. [#311](https://github.com/Aris-ngoy/qa-agent/issues/311): web in the desktop picker. [#312](https://github.com/Aris-ngoy/qa-agent/issues/312): skill and public docs.
