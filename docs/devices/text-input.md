# Text input (iOS / Android)

## Goal

Type into the focused field on iOS and Android through the Argent session (`keyboard` tool via `type` / `input`).

## Plan summary

Typing used to go through WebdriverIO / Appium (`mobile: type` and W3C key chords). That path is gone. The runner shells out to `argent run keyboard`.

## What shipped

- [`session.ts`](../../services/runner/src/domains/argent/session.ts) — `session.type()` runs `argent run keyboard`.
- [`interaction.ts`](../../services/runner/src/domains/devices/interaction.ts) — `input` still taps (when x/y or a locator is given) then `session.type`.

## How to verify

1. Connect a device and type from the Inspector or `yoqa action type`.
2. Agent `input` / `type` steps land in the focused field.

## Follow-ups

If text still misses, the field was not focused (tap the field first) or the software keyboard was dismissed.
