---
status: accepted
---

# Web is a Direct lane over CDP to a Chromium browser

> Superseded in part by [ADR-0009](./0009-everyday-browser-consent-attach.md): Yoqa attaches to the user's everyday browser by consent, and attach by port is CLI/CI only. This replaces the *Attach by port* bullet and the "attaching to a user's everyday browser" part of *Attach only* below.

> Why Firefox and Safari are out of scope: [ADR-0010](./0010-no-firefox-or-safari-browser-device.md).

Teams that ship an Expo or React Native Web build, or only an SPA, want the same Test Cases, CLI loop and Runs against a web page. [ADR-0005](./0005-direct-only-lane.md) says a Lane is Direct only: straight to the platform's own tooling, with no WebDriver server in between. For a browser, that tooling is the Chrome DevTools Protocol (CDP).

We add a third platform, `web`, whose Direct lane speaks CDP to a Chromium-family browser (Chrome, Edge, Brave, Chromium). The Lane name stays `direct`. There is no second Lane, no WebDriver and no Playwright server, so ADR-0005 still holds.

- **Our own CDP client.** A small typed client over Bun's WebSocket that sends only the commands the lane needs. There is no Puppeteer or Playwright dependency: the packaged runner stays small, and no driver sits between the lane and the browser.
- **A browser is a device.** It is a device of kind `browser`. The Device Session drives one page of it. Coordinates are 0–1000 of the page viewport, never the browser window, and the screenshot is that viewport.
- **Attach by port.** A user-started Chromium is named by its debug port (`chromium-cdp-9222`). Ports are never scanned, and attach is localhost only. Chrome 136 and later refuse remote debugging on the default profile, so a user must start it with a non-default `--user-data-dir`. A port with no CDP endpoint fails the connect and says so. Disconnecting closes only the DevTools socket.
- **Yoqa-owned instances come next.** Launching an installed browser with a throwaway profile (#308) is the main path, the way booting is for a simulator. Attach is the secondary path, for a browser profile the user prepared.
- **Same session rules.** Per-device exclusivity ([ADR-0001](./0001-device-session-ownership.md)) applies. A closed socket or a closed page is a Dead Session. The Frame Feed is Screenshot Poll, and the lane does not record.

## Considered options

- **Playwright or Puppeteer as the driver:** rejected. Either adds a large dependency to the packaged runner, plus a driver layer, which is what ADR-0005 removed.
- **Attach only:** rejected as the main path. Nothing lists running debug ports, Chrome refuses the default profile, and attaching to a user's everyday browser would put the agent in their logged-in session.
- **A separate `cdp` Lane:** rejected. It would bring back Lane selection, which ADR-0005 removed. Inside the Direct lane, CDP is just how the `web` device class is driven (implementation `cdp`).

## Consequences

- `DevicePlatform` gains `web` and `DeviceKind` gains `browser`. Both changes are additive, so mobile clients and saved rows still parse.
- Every per-platform branch needs a `web` case. The exhaustive switches from #302 make the typecheck enforce this.
- Remote CDP endpoints are out of scope. Firefox and Safari are too, for the reasons in [ADR-0010](./0010-no-firefox-or-safari-browser-device.md).
