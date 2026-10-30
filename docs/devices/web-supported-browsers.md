# Supported browsers

## Goal

Say which browsers are web devices, and make a Firefox or Safari device id fail with the reason instead of as an unknown id (#375, decided in #350).

## Plan summary

- Every Browser device is a Chromium-family browser driven over CDP. Firefox and Safari get no Browser device for now: Firefox's WebDriver BiDi has no accessibility tree with boxes and no touch emulation, and Safari's automation windows can't keep logins and need `safaridriver`, a WebDriver server. The reasons are in [ADR-0010](../adr/0010-no-firefox-or-safari-browser-device.md).
- Firefox and Safari are not listed in `yoqa devices web` or the desktop picker. Listing a browser that can't be picked was rejected as noise.
- Safari automation on 27.2 is unproven (#351): every session was refused even with "Allow remote automation" on.

## What shipped

- **Supported web devices:**
  - Installed browsers Yoqa launches: `web-chrome`, `web-edge`, `web-brave`, `web-chromium` ([web-installed-browsers.md](./web-installed-browsers.md)).
  - Everyday browsers attached by consent: `web-chrome-everyday`, `web-edge-everyday`, `web-brave-everyday`, `web-chromium-everyday`, `web-dia-everyday` ([web-everyday-browser.md](./web-everyday-browser.md)).
  - A Chromium started with a debug port, from the CLI and CI: `chromium-cdp-<port>` ([web-attach-by-port.md](./web-attach-by-port.md)).
- **Not supported:** Firefox and Safari. `web-firefox`, `web-safari`, `web-firefox-everyday` and `web-safari-everyday` fail before anything is probed with "Firefox and Safari are not supported yet: the web lane drives Chromium browsers over CDP (ADR-0010)", followed by the list of web device ids. Any other unknown web id keeps the plain list. The CLI treats the four ids as web devices, so they need no `--platform`.
- ADR-0007 now points to ADR-0010 for why Firefox and Safari are out of scope.

## How to verify

- `bun test services/runner/src/domains/devices/web-direct-lane.test.ts`: the "fails saying Firefox and Safari are not supported" cases.
- `bun test packages/cli/src/platform.test.ts`: the CLI treats a Firefox or Safari id as web, so `yoqa devices connect web-firefox` (and `--device web-firefox` on a Run) reaches the runner and prints that message instead of "--platform must be …".

## Follow-ups

- Re-check #351 on the next Safari point release.
- The Firefox page-script Screen spike stays in map #339's "Not yet specified" list, unscheduled.
