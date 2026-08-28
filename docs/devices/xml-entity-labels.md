# XML entity labels

## Goal

Make tap-by-label work for accessibility text that contains `&` (e.g. **Help & Info**). Agent runs were failing with `No element matching label: Help & Info` even when the instruction named that control.

## Plan summary

Appium page source is XML, so `text="Help &amp; Info"` is the on-device string. The screen cleaner copied attributes verbatim, so the cleaned tree stored `Help &amp; Info`. The vision agent (and humans) search for `Help & Info`. Exact and substring match both failed, and `--x/--y` on the same tap were ignored because a label was present.

Decisions:

- Decode XML entities when parsing page-source attributes so cleaned labels/ids are human strings.
- Decode entities on both sides of `findElementByLabel` / `screenHasText` so saved instructions still written as `--label 'Help &amp; Info'` keep matching.
- Keep preferring `--label` over coordinates (permission-dialog path). No coord fallback on miss.

Rejected: cascading decode (`&amp;lt;` → `<`). A single pass leaves `&amp;lt;` as `&lt;`.

## What shipped

- [`xml-entities.ts`](../../packages/runner-client/src/xml-entities.ts) — `decodeXmlEntities` (named `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` plus numeric `&#…;` / `&#x…;`).
- [`shell-script.ts`](../../packages/runner-client/src/shell-script.ts) — label/text matching normalizes entities.
- [`screen.ts`](../../services/runner/src/domains/devices/screen.ts) — `attrsFromTag` decodes attribute values.

Existing cases with `--label 'Help &amp; Info'` keep working via needle decode. New inspector inserts from a live tree will use `&`.

## How to verify

1. Unit tests: `bun test packages/runner-client/src/xml-entities.test.ts packages/runner-client/src/shell-script.test.ts services/runner/src/domains/devices/screen.test.ts services/runner/src/domains/devices/interaction.test.ts`
2. With **Help & Info** on screen: `yoqa action tap --label 'Help & Info'` (and `--label 'Help &amp; Info'`) both tap the control.
3. Re-run the desktop test case whose instruction includes that tap — it should no longer stop with `No element matching label: Help & Info`.

## Follow-ups

- None for matching. If a control still misses, it is off the cleaned tree (WebView, unlabeled parent), not entity encoding.
