---
status: accepted
---

# Web testing on macOS: Kept profiles, any Chromium browser, a streamed Inspector

[ADR-0007](./0007-web-direct-lane-over-cdp.md) made web a Direct lane over CDP. It assumed a throwaway profile, polled screenshots for the Inspector, and listed four browsers. Map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339) set out to fix three problems with that. Users had to sign in again on every connect. They could pick only some of the browsers they had installed. And the web Inspector flickered and picked elements badly. Every decision on the map has shipped. [ADR-0009](./0009-everyday-browser-consent-attach.md) (the Everyday browser) and [ADR-0010](./0010-no-firefox-or-safari-browser-device.md) (no Firefox or Safari) were recorded along the way. This ADR closes the map. It records the rest and replaces the parts of ADR-0007 they overturn.

- **Never sign in twice: the Kept profile is the default.** A browser Yoqa launches opens on the App's Kept profile, one per App and browser under `~/.yoqa/browser-profiles/<app>/<browser>/` (#346). Disconnecting, reconnecting and Runs keep it, and only a reset deletes it. A Run may ask for `profile: clean`, a throwaway profile deleted on disconnect. A Run adopts the Active Session only when it has the same App and profile. Otherwise it reopens at the session's preset. The mock-keychain launch flags stay as they were.
- **Any installed Chromium browser.** Yoqa launches Chrome, Edge, Brave, Chromium and Dia (`web-<browser>`). It also launches Arc, Opera and Vivaldi, marked `unverified` (#349). Each of them can also be attached as an Everyday browser (`web-<browser>-everyday`, ADR-0009). Only installed browsers are listed, with one state line per row. A browser stays `unverified` until a hand check, like the ones on #352 and #355, clears it. The fix for a check that fails is that browser's entry in `WEB_BROWSERS`, not a new code path. The device the user last picked is remembered app-wide, not per App.
- **The Inspector streams.** The web Frame Feed is a Stream. A `Page.startScreencast` feed is served on `/stream.mjpeg` and cropped to the Viewport preset (#347). It runs only while someone watches. A single screenshot (a Result screenshot, `yoqa screenshot`) stays on `Page.captureScreenshot`. Polling `captureScreenshot` under device emulation re-emulated the view on every capture, which was the flicker (#344).
- **One shared Screen, made right.** The Inspector, Grounding and Tree assist read the same web Screen, and none gets a tree of its own (#348). Boxes are in CSS pixels, not device pixels (#358). Same-origin and out-of-process iframes are spliced into the one tree (#360). The cleaner drops text echoed inside a control and keeps unnamed images that have an id (#361). The hover tree refreshes when the page changes, not on a timer (#362). Selectors stay `data-testid`, then DOM `id`, then role plus name.
- **macOS only.** Discovery, launch, Kept-profile locks and the Everyday browser are built and checked on macOS. The Windows work was closed on 2026-10-31 (#353 ran, #354 not planned, the Windows part of #349 dropped).

This replaces three parts of ADR-0007:
- The *Yoqa-owned instances come next* bullet. Its "throwaway profile" is now the Kept profile by default and `profile: clean` on request.
- "The Frame Feed is Screenshot Poll" in *Same session rules*. It is now a screencast Stream.
- The browser list (Chrome, Edge, Brave, Chromium). It is now the eight Chromium browsers above.

Everything else in ADR-0007 still holds: one Direct lane over our own CDP client, a browser as a device driven one page at a time, 0–1000 of the page viewport, per-device exclusivity and Dead Sessions. So do ADR-0009 and ADR-0010.

## Considered options

- **Keep a throwaway profile per connect:** rejected. It fails "never sign in twice", and Dia's sign-up wall has a reCAPTCHA the agent cannot pass (#352).
- **One Kept profile per browser, shared by every App:** rejected. Two Apps under test would share cookies and accounts, and resetting one App's login would reset every App's.
- **Keep polling, and avoid the flicker another way:** rejected. Every `captureScreenshot` under emulation resizes the view. The screencast paints only when the view changes, so it is also cheaper while the page is still.
- **An Inspector-only tree for picking:** rejected (#348). Fixing the shared cleaner improves Grounding and Tree assist as well, and keeps one Screen to test.
- **CSS or text selectors in Case Scripts:** rejected (#348). A Case Script keeps the same targets on web as on mobile: an id, a label, or x,y.
- **Leave unverified browsers out of the picker:** rejected. They share Chromium's launch, and the flag says honestly that no one has checked them.
- **Windows in this map:** closed by the owner (2026-10-31). It reopens as its own map, starting from #353's results and #354's provisional recommendation.

## Consequences

- The Kept profile's lock is POSIX (`SingletonLock`) only, which matches macOS only. A Yoqa-launched browser that outlives the runner (the runner exits without quitting its session) still holds its profile, so the next connect fails with `ProfileInUseError` until that browser quits. Fixed by #381.
- A Run that opens its own web session always gets the desktop preset. Only a Run that adopts a connected session can run at another one. Fixed by #382 (runner and CLI) and #383 (desktop).
- Arc, Opera and Vivaldi ship on assumptions, recorded in [web-supported-browsers.md](../devices/web-supported-browsers.md). Arc may need Dia's `User Data` port-file folder. The hand checks are #385.
- Safari's MCP mode (#351) stays parked until the next Safari release after 27.2. It reopens the Safari decision only if it drives the user's own signed-in windows (ADR-0010).
- An open JavaScript dialog is not on the web Screen, and a capture may wait on it: #384.
- Not decided here: picking an Everyday profile other than the browser's default context, a Firefox Screen read by a page script, and native HTML5 drag-and-drop.
