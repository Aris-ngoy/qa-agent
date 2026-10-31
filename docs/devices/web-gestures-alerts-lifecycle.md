# Web: swipe, drag, alert and app lifecycle

## Goal

Shared cases keep their meaning on web ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). The tracer bullet ([web-attach-by-port.md](./web-attach-by-port.md)) rejected swipe, drag, alert and every lifecycle Action as "not available yet". This slice gives each one its browser meaning, so "swipe up to find X", a slider, a `confirm()` and a restart step in a cross-platform Test Case all do something real, or fail clearly. Ticket [#305](https://github.com/Aris-ngoy/qa-agent/issues/305). Vocabulary: **Action**, **Lane**, **Device Session**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **Swipe is a wheel scroll at the start point.** The delta is the swipe vector reversed, in CSS pixels: a finger drags content with it, so swipe up (y falls) scrolls the page down. One `mouseWheel` event lets the page scroll whatever is under the point, a list or the page itself. Rejected: `window.scrollBy`, which only scrolls the document and not the scrollable element under the point. The touch swipe for mobile presets comes with [#310](https://github.com/Aris-ngoy/qa-agent/issues/310).
- **Drag is a real mouse press, move and release.** The pointer moves to the start, presses, moves to the end in 10 steps across the duration (800 ms by default, as on Android) with the left button held, and releases. Sliders and pointer-event drag-and-drop libraries see a real gesture.
- **Alert is the page's JavaScript dialog.** The lane enables the Page domain on the page it drives, so an `alert`, `confirm`, `prompt` or `beforeunload` dialog waits for an answer. `alert --accept` / `--dismiss` answers it with `Page.handleJavaScriptDialog`. Accepting a `prompt` keeps its default text, as pressing OK would. With no dialog open, the Action fails with "No JavaScript dialog is open on the page". An open dialog is also on the Screen, where a tap on OK or Cancel answers it ([web-screen.md](./web-screen.md#javascript-dialogs)).
- **On web, an app id is the App's Web URL.** Lifecycle Actions take an http(s) URL, and anything else fails, naming the Web URL. Until the App carries a Web URL ([#309](https://github.com/Aris-ngoy/qa-agent/issues/309)), callers pass it as `--app-id`.
  - **terminate-app** closes the App's page. A blank page opens and the session moves to it first, because closing the browser's last tab can quit the browser. The session is never left without a page, and an intentional close is not a Dead Session.
  - **activate-app** brings a page that is already on the App's origin to the front, the way activating a running app does not restart it. Any other page navigates to the URL.
  - **restart-app** closes the App's page, clears all storage for its origin (`Storage.clearDataForOrigin`, cookies included), then loads the URL in the fresh page. That is more than terminate then activate, so `DeviceSession` gains an optional `restartApp`. Lanes without it keep the old pair, so iOS and Android do not change. Rejected: clearing storage while the old page is still open, since its unload handlers could write storage back.
  - **background-app** fails with "background-app is not supported on web". A page has no background, and a cross-platform case must not pass a step it never ran.
- **Unsupported is a typed failure.** `ActionUnsupportedError` (in `lane.ts`) is what a Lane throws for an Action its platform cannot do. `POST /action` answers it with 422 `Action not supported`, plus the reason. In a Run it is not a retriable Action error, so the case errors with that message.

## What shipped

- **Runner**
  - `web-direct-lane.ts`: swipe, drag, accept/dismiss alert, activate/terminate/restart-app on the page, and background-app failing as unsupported. The session's page can now change (after terminate-app). The Dead Session check follows the current page's session, so detaching from a page the session closed on purpose is ignored.
  - `cdp-client.ts`: types for `mouseWheel`, `Target.getTargetInfo` / `closeTarget`, `Page.enable` / `handleJavaScriptDialog` and `Storage.clearDataForOrigin`.
  - `lane.ts`: `ActionUnsupportedError` and the optional `DeviceSession.restartApp`. `interaction.ts` uses `restartApp` when a Lane has one.
  - `interfaces/http/session.ts`: `POST /action` maps `ActionUnsupportedError` to 422. `/action/batch` already reports a failed step's message with 422.
- **Tests**
  - `fake-cdp.ts` now models pages as targets that open, attach and close. It records mouse and wheel events, dialog answers and cleared origins, and can open a JavaScript dialog on the driven page.
  - Web-only cases in the Lane contract suite: wheel direction for swipe up and right, press-move-release for drag, and dialog accept, dismiss and none-open.
  - `web-direct-lane.test.ts` covers the lifecycle Actions against the faked CDP endpoint.
  - background-app fails clearly through `POST /action` (`active-session.test.ts`) and through the agent loop (`case-executor.test.ts`).

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "web"
bun test services/runner/src/domains/devices/web-direct-lane.test.ts
bun test services/runner/src/domains/devices/active-session.test.ts services/runner/src/domains/runs/case-executor.test.ts
bun run lint:ci && bun run test && bun run check
```

By hand, with a Chrome started as in [web-attach-by-port.md](./web-attach-by-port.md):

```bash
yoqa devices connect chromium-cdp-9222
yoqa action open-url --url https://en.wikipedia.org/wiki/Web_browser
yoqa action swipe --x 500 --y 800 --x2 500 --y2 200   # the article scrolls down
yoqa action open-url --url "javascript:setTimeout(()=>confirm('ok?'),0)"
yoqa action alert --dismiss                            # the confirm closes
yoqa action restart-app --app-id https://en.wikipedia.org/wiki/Web_browser
yoqa action terminate-app --app-id https://en.wikipedia.org/
yoqa action activate-app --app-id https://en.wikipedia.org/wiki/Web_browser
yoqa action background-app                             # Action not supported: … not supported on web
```

## Follow-ups

- Done in [#384](https://github.com/Aris-ngoy/qa-agent/issues/384): an open dialog leads the Screen as a `modal` with its OK and Cancel buttons, a tap on one answers it, and a capture under it returns the last screenshot instead of waiting. See [web-screen.md](./web-screen.md#javascript-dialogs).
- Native HTML5 drag-and-drop (`draggable`, `dragstart`) may need `Input.setInterceptDrags` and `Input.dispatchDragEvent`. Pointer- and mouse-event drags work now.
- [#309](https://github.com/Aris-ngoy/qa-agent/issues/309): the App's Web URL as the default app id on web. [#310](https://github.com/Aris-ngoy/qa-agent/issues/310): a touch swipe under a mobile viewport preset. [#306](https://github.com/Aris-ngoy/qa-agent/issues/306): following popups.
