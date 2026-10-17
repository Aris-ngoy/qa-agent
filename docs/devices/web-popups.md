# Web: follow new tabs and popups

## Goal

Sign-in and external-link flows work on web with no tab management ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301), story 30). When the page the Device Session drives opens another page (`window.open`, a `target=_blank` link, an OAuth popup), the session moves to it: screenshots, the Screen and Actions act on the new page. When that page closes, the session goes back to the page that opened it. Ticket [#306](https://github.com/Aris-ngoy/qa-agent/issues/306). Vocabulary: **Device Session**, **Lane**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **The session drives one page at a time.** After attaching, the lane turns on `Target.setDiscoverTargets` and watches `Target.targetCreated`. A page whose `openerId` is the driven page is attached (Page domain enabled, brought to front) and becomes the driven page. The page it left goes on a stack of openers.
- **Closing goes back to the opener.** When the driven page detaches and an opener is still open, that opener is driven again and brought to the front, since a background tab never paints. A popup of a popup unwinds one level at a time. An opener that closes while a popup is driven is dropped from the stack. Only when no opener is left is a closed page a Dead Session, as before.
- **Pages the session's page did not open are ignored.** A tab the user opens, or the blank page terminate-app opens, has no opener on the driven page, so it never takes over.
- **Commands wait for a move.** A switch is a short chain of CDP commands. Every command to the page, and every Action under the action lock, waits for a pending switch first, so nothing lands on the page the session is leaving.
- **Coordinates follow the page.** The viewport is read from the driven page for each Action, so a popup with its own window size maps 0–1000 onto its own viewport, and its screenshot is its own viewport. Since [#310](https://github.com/Aris-ngoy/qa-agent/issues/310) every page is at the session's Viewport preset instead ([web-viewport-presets.md](./web-viewport-presets.md)).
- Rejected: a user-facing tab list or switch (out of scope in the spec), and following every new page (an unrelated tab would steal the session).

## What shipped

- `web-direct-lane.ts`: popup following and return to the opener, with an opener stack and a page-switch chain the page commands wait on.
- `cdp-client.ts`: `Target.setDiscoverTargets`, and `openerId` on `TargetInfo`.
- `fake-cdp.ts`: pages have their own viewport and click record (`clicksOn`), `openPage` opens a page as the front page's popup or as an unrelated tab, `closePage` closes any page, `frontPage` names the page in front, and target discovery announces new pages.
- Lane contract suite (web-only cases): a popup becomes the driven page at its own viewport (window and screenshot space, screenshot size); closing it returns to the opener with the opener's viewport and no Dead Session; nested popups unwind; an unrelated tab neither takes over nor ends the session when it closes.

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "web"
bun run lint:ci && bun run test && bun run check
```

By hand, with a web device connected (see [web-installed-browsers.md](./web-installed-browsers.md)):

```bash
yoqa action open-url --url "data:text/html,<a href='https://example.com' target='_blank' style='font-size:80px'>open</a>"
yoqa action tap --x 100 --y 50     # the link opens a new tab
yoqa screenshot                    # example.com
# close that tab in the browser
yoqa screenshot                    # the page with the link again
```

## Follow-ups

- Popup following is tested against the faked CDP endpoint only. The manual check above should confirm that real Chromium sets `openerId` on a `noopener` link's tab (it reports `canAccessOpener: false` there); if it does not, `openerFrameId` would cover it.
- An Action that is mid-gesture when a popup opens finishes on the popup (e.g. the release of a long press).
