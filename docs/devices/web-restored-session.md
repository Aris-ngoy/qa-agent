# Web: a page that closes while the session attaches

## Goal

Stop Dia's connects from failing with `Page.enable: the browser did not answer within 30000 ms`. The hand check on [#385](https://github.com/Aris-ngoy/qa-agent/issues/385) saw four failures in a row on one App's Kept profile, then ten passes, with no clear cause. Vocabulary: **Kept profile**, **Device Session** in [`CONTEXT.md`](../../CONTEXT.md). Background: [web-kept-profile.md](./web-kept-profile.md).

## Plan summary

- **Cause.** After an unclean exit, Dia restores the last session's tabs on its next launch. A runner that was killed, or a `stop()` that had to SIGKILL, leaves this state behind. While the tabs are restored, Dia closes the page it opened at launch, or the blank page the lane just created. If that happens between `Target.attachToTarget` and `Page.enable`, the closed page never answers. The CDP client then waited out its whole 30 s timeout. The order is a race, so only some launches after an unclean exit hit it, and a clean exit leaves nothing to restore.
- **The CDP client fails a command whose session goes away.** When `Target.detachedFromTarget` names a session, every pending command on it fails at once with `CdpSessionGoneError` (`<method>: the page closed before it answered`). This holds everywhere, not only at connect: a command to a page the user closes no longer hangs either.
- **The lane picks again.** If the page it was attaching closes, `createWebDirectSession` picks a page again, up to three times. That is the first restored tab, or a new blank page. Then it attaches as usual.
- Rejected:
  - Marking the profile as cleanly exited before launch. That edits Dia's private `Preferences`. Dia also restores tabs after a clean exit, so it would not remove the race.
  - A longer timeout. The page is gone, so no timeout would ever be long enough.

## What shipped

- `cdp-client.ts`: pending commands remember their session, and a `Target.detachedFromTarget` for that session rejects them with the new `CdpSessionGoneError`.
- `web-direct-lane.ts`: `pickAndAttachPage` wraps `pickPage` and `attachPage`, and retries on `CdpSessionGoneError`. In an Everyday browser, the window it opened is still the one closed if setup fails.
- `fake-cdp.ts`: a `restoresSession` option that does what Dia does. On the first `Page.enable`, it closes the page without answering and opens the restored tabs.
- Tests:
  - `cdp-client.test.ts`: the command fails at once, and the socket stays open.
  - `web-direct-lane.test.ts`, *a page closed while it is attached*: the session attaches to the restored tab.

## How to verify

- `bun test services/runner/src/domains/devices/cdp-client.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts`
- By hand, with Dia:
  1. Connect `web-dia` on an App, open a page, then `kill -9` the main Dia process (`/Applications/Dia.app/Contents/MacOS/Dia --user-data-dir=…`).
  2. Connect again. It connects in about a second, on a restored tab or a blank page, and never waits 30 s.
  - The race doesn't happen on every launch. On 2026-10-31 (Dia 1.55.1), one in five relaunches after a kill closed the attached page. `Page.enable` then failed straight away with "the page closed before it answered", where before it hung.

## Follow-ups

None.
