# Supported browsers

## Goal

Say which browsers are web devices, and make a Firefox or Safari device id fail with the reason instead of as an unknown id (#375, decided in #350). Then add Arc, Opera and Vivaldi in both forms, marked unverified until a hands-on check clears them (#378, decided in #349).

## Plan summary

- Every Browser device is a Chromium-family browser driven over CDP. Firefox and Safari get no Browser device for now: Firefox's WebDriver BiDi has no accessibility tree with boxes and no touch emulation, and Safari's automation windows can't keep logins and need `safaridriver`, a WebDriver server. The reasons are in [ADR-0010](../adr/0010-no-firefox-or-safari-browser-device.md).
- Firefox and Safari are not listed in `yoqa devices web` or the desktop picker. Listing a browser that can't be picked was rejected as noise.
- Safari automation on 27.2 is unproven (#351): every session was refused even with "Allow remote automation" on.
- **One list of browsers.** `WEB_BROWSERS` in `@yoqa/runner-client` (`web-browsers.ts`) names each browser's short name (`chrome`), its name (also its app bundle's), and whether it is `verified`. The runner's launched and Everyday lists, the CLI's web ids and the desktop's Open the setting all derive from it, so a browser the runner lists can't be refused by the CLI. Rejected: a regex per consumer, which is what let the CLI's copy drift before.
- **Unverified, not gated.** Arc, Opera and Vivaldi are listed whenever installed, with no flag to turn them on, and a launch or connect that fails gives the browser's own error. Hiding them until checked was rejected: a user who has only Arc would see no browser at all.

## What shipped

- **Supported web devices:**
  - Installed browsers Yoqa launches: `web-chrome`, `web-edge`, `web-brave`, `web-chromium`, `web-dia`, and unverified `web-arc`, `web-opera`, `web-vivaldi` ([web-installed-browsers.md](./web-installed-browsers.md)). A fresh Dia profile opens on a sign-up wall with a reCAPTCHA: sign in by hand once, and the Kept profile keeps it (#352).
  - Everyday browsers attached by consent: `web-chrome-everyday`, `web-edge-everyday`, `web-brave-everyday`, `web-chromium-everyday`, `web-dia-everyday`, and unverified `web-arc-everyday`, `web-opera-everyday`, `web-vivaldi-everyday` ([web-everyday-browser.md](./web-everyday-browser.md)).
  - A Chromium started with a debug port, from the CLI and CI: `chromium-cdp-<port>` ([web-attach-by-port.md](./web-attach-by-port.md)).
- **Not supported:** Firefox and Safari. `web-firefox`, `web-safari`, `web-firefox-everyday` and `web-safari-everyday` fail before anything is probed with "Firefox and Safari are not supported yet: the web lane drives Chromium browsers over CDP (ADR-0010)", followed by the list of web device ids. Any other unknown web id keeps the plain list. The CLI treats the four ids as web devices, so they need no `--platform`.
- ADR-0007 now points to ADR-0010 for why Firefox and Safari are out of scope.
- **`verified` on a web Device** (#378): `true` for Chrome, Edge, Brave, Chromium and Dia, `false` for Arc, Opera and Vivaldi, in both forms. It is optional on `deviceSchema` (phones leave it out). `formatDeviceState` adds `unverified` after the state, so `yoqa devices web` prints `Arc — 1.106.0 [not running · unverified]` and the desktop picker shows the same on its Browsers and Your browser rows; `--json` carries the field.
- The runner's "names no browser" hint lists every launched id from `WEB_BROWSERS`.

### Unverified: Arc, Opera and Vivaldi

None of the three was installed for a hand check (#343, #355), so each is `verified: false`. What is assumed, all unverified:

| | Arc | Opera | Vivaldi |
| --- | --- | --- | --- |
| Bundle and binary | `Arc.app/Contents/MacOS/Arc` | `Opera.app/Contents/MacOS/Opera` | `Vivaldi.app/Contents/MacOS/Vivaldi` |
| Launched port file | `<user-data-dir>/DevToolsActivePort` | same | same |
| Everyday user-data folder | `~/Library/Application Support/Arc/User Data` | `…/com.operasoftware.Opera` | `…/Vivaldi` |
| Remote-debugging setting | `chrome://inspect/#remote-debugging` | `chrome://inspect/…`, maybe `opera://inspect/…` | `chrome://inspect/#remote-debugging` |

Arc comes from the same company as Dia and keeps its profiles under `User Data` the way Dia does, so a launched Arc may write its port file under `<user-data-dir>/User Data/` like Dia (#343). That is the first thing to check if `web-arc` times out waiting for a debug port; the fix is `arc: "User Data"` in `PORT_FILE_DIRS`.

**What clears a browser:** a hand check like #352 (launched, on a Kept profile: connect, sign in, reconnect keeps it) and #355 (Everyday: toggle, Allow, drive Yoqa's window, disconnect). Each that passes flips its `verified` to `true` in `WEB_BROWSERS`, with the facts above corrected here.

## How to verify

- `bun test services/runner/src/domains/devices/web-direct-lane.test.ts`: the "fails saying Firefox and Safari are not supported" cases.
- `bun test packages/cli/src/platform.test.ts`: the CLI treats a Firefox or Safari id as web, so `yoqa devices connect web-firefox` (and `--device web-firefox` on a Run) reaches the runner and prints that message instead of "--platform must be …". "every id the runner lists is web" lists every browser in both groups from faked bundles and fails if the CLI refuses one.
- `bun test packages/runner-client/src/web-browsers.test.ts packages/cli/src/devices-everyday.test.ts`: the list, `verified`, and `unverified` in `yoqa devices web`.
- By hand, on a Mac with Arc, Opera or Vivaldi: `yoqa devices web` lists it `[not running · unverified]` and its Everyday entry `[remote debugging off · unverified]`; the desktop picker shows `unverified` on both rows.

## Follow-ups

- The hand checks that clear Arc, Opera and Vivaldi (above), including Arc's port-file folder and Opera's setting page.
- Re-check #351 on the next Safari point release.
- The Firefox page-script Screen spike stays in map #339's "Not yet specified" list, unscheduled.
