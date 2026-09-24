# Text input (iOS / Android)

## Goal

Stop agent and inspector `type` / `input` steps from failing on iOS with:

`Key Down action '-' must have a closing Key Up successor`

Typing a multi-character string (including values with `-`) should land in the focused field on both XCUITest and UiAutomator2.

## Plan summary

WebdriverIO 9's `browser.keys()` emits every `keyDown` first, then every `keyUp` (a chord). WebDriverAgent requires each `keyDown` to be immediately followed by its own `keyUp`. The error names the last character because that `keyDown` is followed by a different key's `keyUp`. UiAutomator2 tolerates the chord, which is why the failure was iOS-only.

Decisions:

- Prefer Appium `mobile: type` (types into the focused element / visible keyboard on both drivers).
- Fall back to a W3C `key` action chain with per-character `{keyDown, keyUp}` pairs when `mobile: type` is an unknown/unsupported command.
- Re-throw other `mobile: type` errors (e.g. no focused field) instead of silently falling back.
- Empty string is a no-op.

Rejected: wrapping `browser.keys()` with `releaseActions` — the payload shape is still a chord, which WDA rejects before release.

## What shipped

- [`keyboard.ts`](../../services/runner/src/domains/devices/keyboard.ts) — `typeText(browser, text)` with `mobile: type` then W3C fallback.
- [`session.ts`](../../services/runner/src/domains/devices/session.ts) — `session.type()` calls `typeText` instead of `browser.keys(text.split(""))`.
- [`interaction.ts`](../../services/runner/src/domains/devices/interaction.ts) is unchanged: `input` still taps (when x/y or a locator is given) then `session.type`.

## How to verify

1. Unit tests: `bun test services/runner/src/domains/devices/keyboard.test.ts`
2. Re-run the iOS case whose `type`/`input` step includes a hyphen (or any multi-character string). The run should type into the focused field instead of stopping on the WDA keyDown error.
3. Android `input` / `type` still types as before (`mobile: type` on UiAutomator2).

## Follow-ups

- None for this WDA constraint. If text still misses, the field was not focused (tap the field first) or the software keyboard was dismissed.
