# Text input (iOS / Android)

## Goal

Type into the focused field on iOS and Android through the Argent session (`type` / `input`).

## Plan summary

Typing used to go through WebdriverIO / Appium (`mobile: type` and W3C key chords). That path is gone. The runner types through the Argent session: plain text goes via `argent run keyboard --text`; text containing newlines runs as a single Argent `run-sequence` (keyboard text step + `key: enter` steps).

## What shipped

- [`session.ts`](../../services/runner/src/domains/devices/session.ts) — `session.type()` routes newline text through a single Argent `run-sequence` (keyboard text step + `key: enter` steps); plain text goes through `argent run keyboard --text`.
- [`interaction.ts`](../../services/runner/src/domains/devices/interaction.ts) — `input` still taps (when x/y or a locator is given) then `session.type`.

## How to verify

1. Connect a device and type from the Inspector or `yoqa action type`.
2. Agent `input` / `type` steps land in the focused field.

## Follow-ups

If text still misses, the field was not focused (tap the field first) or the software keyboard was dismissed.
