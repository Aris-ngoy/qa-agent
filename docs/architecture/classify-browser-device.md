# Classify a Browser device once

## Goal

A Browser device ([CONTEXT.md](../../CONTEXT.md)) has three ways in: a browser Yoqa launches (`web-chrome`), the user's Everyday browser (`web-chrome-everyday`, [ADR-0009](../adr/0009-everyday-browser-consent-attach.md)), and a browser attached by its debug port (`chromium-cdp-9222`, [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md)). Firefox and Safari ids are web ids with no way in ([ADR-0010](../adr/0010-no-firefox-or-safari-browser-device.md)). The runner, the CLI and the desktop each re-parsed the device id with their own copy of these rules, and the copies disagreed. The goal was one deep module that classifies an id, which every caller asks.

## Plan summary

- **One classifier in `@yoqa/runner-client`, next to `WEB_BROWSERS`.** `webDeviceOf(id)` returns a discriminated union, or null for an id that names no web device (a phone, a simulator, a typo). The interface is one function; the id rules (browser list, `-everyday` suffix, port range, the Firefox/Safari pattern) are its implementation, so callers get leverage without knowing them and the rules have locality.
- **The runner's rules are the source of truth.** Ports are 1–5 digits in 1–65535; an Everyday id names one of `WEB_BROWSERS`.
- **Inverse builders.** `installedBrowserId` and `everydayBrowserId` already existed; `attachDeviceId(port)` joins them for callers that build a port id.
- **Policy left out of the result.** "Disconnecting quits only a launched browser" lives in the lane's `owned` handle, not the id, and "uses a Kept profile" is decided differently at each site (the active-session reset also checks the session's profile; a Run resolves kept vs clean; the desktop's profile choice is about the picker). Neither is a pure function of the id shared by two callers, so the result carries only `kind`, `id`, `browser` and `port`.
- **Rejected:** a class or a set of `is…` predicates (`isEverydayDeviceId`, `attachPortOf`, `installedBrowserIdOf`): each is a shallow module that re-exposes one rule, which is what we had; a regex shared across packages (still leaves each caller to interpret the match); moving connection logic onto the classifier (the lane owns how to connect; the classifier only says which way in).

## What shipped

- `packages/runner-client/src/web-browsers.ts`: `webDeviceOf(id): WebDevice | null`, where `WebDevice` is
  - `{ kind: "launched", id: InstalledBrowserId, browser }`
  - `{ kind: "everyday", id: EverydayBrowserId, browser }`
  - `{ kind: "port", id, port, browser: null }`
  - `{ kind: "unsupported", id, browser: null }` (Firefox, Safari)

  plus `attachDeviceId(port)`, `WebBrowser` and `AttachDeviceId`. `webBrowserOf` is gone (`webDeviceOf(id)?.browser`).
- Runner: `attachPortOf` (`chromium-attach.ts`), `everydayBrowserIdOf` (`chromium-everyday.ts`) and the lane's `UNSUPPORTED_BROWSER_ID` are removed. `web-direct-lane.ts`'s `openBrowser`, `runs/application.ts` (the clean-profile refusal names the launched id through `installedBrowserId` instead of `replace(/-everyday$/, "")`), `active-session.ts`, `everyday-warning.ts` and the lane harness ask `webDeviceOf`. `installedBrowserIdOf` stays as a one-line wrapper over it for `interfaces/http/session.ts`, which this change does not touch.
- CLI: `platform.ts` drops its copies (`ATTACH_DEVICE_ID`, `UNSUPPORTED_BROWSER_ID`, `everydayBrowserName`, `isEverydayDeviceId`); `isWebDeviceId` is `webDeviceOf(id) !== null`, and `program.ts` reads the Everyday browser's name from the result.
- Desktop: `isEverydayDeviceId` and the attach regex are gone; `web-device.ts`, `everyday-browser.ts`, `session-bar.tsx`, `runs/utils/web-run.ts` and the bun side's `everyday-browser` (`open -a` app name) ask `webDeviceOf`.
- Tests: one table-driven `webDeviceOf` test in `web-browsers.test.ts`; the parsing tests in `chromium-browsers.test.ts`, `chromium-everyday.test.ts`, `platform.test.ts` and the desktop's `everyday-browser.test.ts` are deleted.

### Behaviour changes

- **Desktop** treated any `web-<letters>-everyday` as an Everyday browser (`web-firefox-everyday`, `web-foo-everyday`). It now accepts only the ids the runner accepts: such an id gets no Allow countdown, no disconnect note, and shows the Run dialog's profile choice. The runner never lists them, so this only matters for a remembered or typed id.
- **Desktop** `browserDevices` keeps a listed browser only when its id is a launched browser's, rather than any browser that is neither Everyday nor attached.
- **CLI** took `chromium-cdp-<any digits>` as web; it now needs a port in 1–65535 (`chromium-cdp-0` or `chromium-cdp-123456` asks for `--platform`, as the runner would refuse it anyway).

## How to verify

- `bun test packages/runner-client/src/web-browsers.test.ts` covers every kind and the edge ids.
- `bun run lint:ci`, `bun run test`, `bun run check`.
- `rg 'chromium-cdp-\(|-everyday\$|isEverydayDeviceId|attachPortOf|everydayBrowserIdOf' apps packages services` finds no copy of the rules outside `web-browsers.ts`.

## Follow-ups

- Replace `installedBrowserIdOf` in `interfaces/http/session.ts` with `webDeviceOf` once that file's restructure lands, and delete the wrapper.
- Test files still build `chromium-cdp-${port}` by hand; they can use `attachDeviceId` when next touched.
