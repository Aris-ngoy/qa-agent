# A browser connection behind the web Direct lane

## Goal

A Browser device ([CONTEXT.md](../../CONTEXT.md)) has three ways in: a browser Yoqa launches on its Kept profile (or a clean one), the user's Everyday browser by consent ([ADR-0009](../adr/0009-everyday-browser-consent-attach.md)), and a browser attached by its debug port ([ADR-0007](../adr/0007-web-direct-lane-over-cdp.md)). `web-direct-lane.ts` opened all three in one function, but their differences then recurred across `createWebDirectSession`, one ~730-line closure that checked `everyday` at six sites and `owned` at three. A change to how the Everyday browser behaves meant reading the whole session. The goal was to decide the way in once, at connect, behind one seam, and to move the Screen reading out as its own module, without changing the Device Session interface the rest of the runner sees.

## Plan summary

- **One interface, three adapters, chosen once.** `openBrowserConnection` asks `webDeviceOf` (from [#425](./classify-browser-device.md)) which way in the id names and returns a `BrowserConnection` from the `launched`, `everyday` or `port` adapter. The session holds the connection and never asks which kind it is.
- **The connection owns every per-kind difference found in the session:** launch or attach; which page a new session drives (the first page, or a blank one in a new window of Yoqa's own in the Everyday browser); the blank page that takes over when terminate-app closes the App's page; the label (`browser`, and `browserProfileName` for the Everyday browser only); what restart-app does to storage; the process exit the session treats as a Dead Session; what a failed setup releases; what a Dead Session releases; and what disconnect does.
- **The session keeps page driving:** attaching pages at the Viewport preset, popups and openers, the screencast Stream, dialogs, input, keys, lifecycle Actions and the Dead Session rules.
- **The Screen reader is its own module.** `web-screen-reader.ts` follows out-of-process iframes and reads the accessibility tree and DOM snapshots into the Screen source. The lane still decides when it may read (not under an open dialog) and wraps its commands so a closed socket is a Dead Session.
- **Rejected:** a `kind` field on the connection that the session switches on (it moves the branches without removing them); a class hierarchy (no shared state between adapters worth inheriting, and factory functions are easier to fake); putting page attachment in the connection (it is the same for every way in, so it would be duplicated three times); moving the Screen tests to the reader (they assert the cleaned Screen through `getScreen`, which is the lane's contract, so they stay in the lane test).

## What shipped

- `services/runner/src/domains/devices/browser-connection.ts`: `BrowserConnection` (`client`, `firstPage`, `blankPage`, `label`, `restartStorage`, `exited`, `abort`, `abandon`, `disconnect(sessionPages)`), the adapters `launchedConnection`, `everydayConnection` and `portConnection`, `openBrowserConnection`, and `BrowserConnectionDeps` / `browserConnectionDeps`. The lane re-exports these as `WebDirectDeps` / `webDirectDeps`, so callers are unchanged.
- `services/runner/src/domains/devices/web-screen-reader.ts`: `createWebScreenReader(client, send)` with one method, `read(sessionId)`. The frame layout, id prefixing and frame splicing helpers moved here unchanged.
- `web-direct-lane.ts` went from 1359 to 890 lines, and nothing in it branches on `everyday` or `owned` any more.
- Tests: `browser-connection.test.ts` tests each adapter through the interface with the fake CDP (`startFakeCdp`, `fakeChromium`). The connect-error, label, quit, Dia, grace, clean-profile, Deny and not-installed cases moved there from `web-direct-lane.test.ts` rather than being copied. The lane test keeps what needs a session (Actions, Stream, restart results, Dead Sessions), plus a check that disconnect closes the popups the session followed in the Everyday browser.

### Behaviour

Unchanged. One mismatch is kept as it was: a browser attached by port clears the App origin's storage on restart-app (`cleared`), which an existing lane test asserts. CONTEXT.md's **Restart** entry says only a browser Yoqa launched clears it. Following the glossary is now a one-line change in `portConnection`.

## How to verify

- `bun test services/runner/src/domains/devices/browser-connection.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
- `bun run lint:ci`, `bun run test`, `bun run check`.
- `rg 'everyday|owned' services/runner/src/domains/devices/web-direct-lane.ts` finds nothing.

## Follow-ups

- Settle whether attach by port should keep storage on restart (CONTEXT.md) or clear it (the code and test today), then change `portConnection.restartStorage` or the glossary to match.
