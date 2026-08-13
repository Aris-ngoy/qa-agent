# Settings page: card layout + HeroUI tabs

## Goal

Make the desktop Settings page match other feature pages (Configuration-style cards) and replace the in-page left aside with HeroUI Tabs.

## Plan summary

- Center the page like Configuration (`mx-auto max-w-3xl`, page title).
- Use the same HeroUI pill Tabs pattern as ScriptPanel on test-case detail.
- Align `SectionCard` with shared `shadow-card` / `rounded-2xl` tokens.
- Keep section switching as local state (not URL segments); gate queries with `enabled` per active tab.
- Left unused `settings-modal.tsx` alone.

## What shipped

- [`apps/desktop/src/mainview/features/settings/settings-page.tsx`](../../apps/desktop/src/mainview/features/settings/settings-page.tsx):
  - Removed aside nav; added Settings header + controlled HeroUI `Tabs` (iOS / Android / CLI & Agents / Provider / Diagnostics).
  - Upgraded `SectionCard` to Configuration card tokens.
  - Wrapped iOS Xcode and Code Signing blocks in `SectionCard`; dropped redundant per-panel `h2` titles on iOS/CLI.
- Provider list wrapped in the same card tokens in [`providers-section.tsx`](../../apps/desktop/src/mainview/features/settings/providers/providers-section.tsx); redundant Provider `h2` removed.

## How to verify

1. Open `/settings` — centered column, “Settings” title, no left settings aside.
2. Switch tabs; content swaps; inactive-tab queries stay gated via `enabled`.
3. Cards match Configuration (radius, border, `shadow-card`).
4. iOS / Android / CLI / Provider actions still work.

## Follow-ups

- Align or remove unused `settings-modal.tsx` if it is revived.
