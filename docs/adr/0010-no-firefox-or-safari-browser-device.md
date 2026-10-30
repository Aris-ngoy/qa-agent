---
status: accepted
---

# No Firefox or Safari Browser device yet

[ADR-0007](./0007-web-direct-lane-over-cdp.md) put Firefox and Safari out of scope without saying why. Map #339 set out to decide every installed browser, with "never sign in twice" as the hard requirement, and researched both (#341, #342).

The web Direct lane stays Chromium over CDP. Neither Firefox nor Safari gets a Browser device for now, and [ADR-0005](./0005-direct-only-lane.md) stands unchanged.

- **Firefox: blocked by the Screen.** WebDriver BiDi is built in with no geckodriver, and its port file (`WebDriverBiDiServer.json`) works like `DevToolsActivePort`. Screenshots, input, viewport, the user-agent override (Firefox 145+) and popups all have equivalents. But BiDi has no accessibility tree, and `locateNodes` returns no boxes (w3c/webdriver-bidi#443). The Inspector, picking and taps by label all stand on the Screen, so a Firefox device would be screenshot-only. Touch emulation (`emulation.setTouchOverride`) is not implemented (bug 2006347), so the mobile Viewport preset would look like a desktop to the page. `restart-app` could clear cookies only, not origin storage.
- **Safari: can't keep logins.** Apple documents automation windows as always starting from a clean slate, and no capability picks a profile, which fails the hard requirement. The only path is `safaridriver`, a WebDriver server: the in-between layer ADR-0005 removed. On macOS it has no touch, no full accessibility tree and no user-agent or metrics emulation in classic WebDriver. It allows one session per Mac, with a glass pane over the window.
- **Unproven on Safari 27.2 (#351).** On the Mac we checked, every `safaridriver` session (MCP mode and plain W3C) was refused with "Allow remote automation" even with the setting on, so whether the MCP mode sees the user's logins is unanswered. The decision does not rest on it.
- **What the user sees.** Firefox and Safari are not listed as web devices. A device id that names them (`web-firefox`, `web-safari`, or their `-everyday` forms) fails before anything is probed, with an error that says why.

## Considered options

- **A Firefox implementation over BiDi inside the web Direct lane:** deferred. It needs a second protocol client in the runner and an amendment to ADR-0005's "no WebDriver client", and it buys no login benefit, since Chromium already covers "never sign in twice". It reopens if BiDi gains a tree with boxes, or if a page-script Screen (a DOM walk with `getBoundingClientRect` over `script.callFunction`) matches Chrome's tree well enough on the Expo demo, and in either case touch emulation lands.
- **Safari over `safaridriver`:** rejected for now. It reopens only if #351 shows the MCP mode drives the user's own signed-in windows, or if clean cross-browser Runs become a need worth a WebDriver client.
- **Listing Firefox and Safari as "not supported" in the picker:** rejected. A browser that can't be picked is noise there; the reason belongs in the docs and in the error.

## Consequences

- Every Browser device is Chromium, so Viewport presets, touch, popups and the Screen don't vary by browser.
- If either browser reopens, it lands as a second implementation inside the web Direct lane (next to `cdp`), not as a new Lane, with an ADR that amends ADR-0005.
- This replaces ADR-0007's "Firefox, Safari … are out of scope" for Firefox and Safari. Remote CDP endpoints stay out of scope there.
