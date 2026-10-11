# Dark-mode coverage

## Goal

Make every main screen and modal legible in dark by moving hardcoded colors in components to semantic tokens (ticket #279, parent #275; builds on [dark-theme.md](dark-theme.md)).

## Plan summary

- A test (`no-hardcoded-colors.test.ts`) scans `apps/desktop/src/mainview` for hex, `rgb(a)`, `*-white`/`*-black` and light-only palette shades (`*-50/100/200/300/800/900/950`), so the criterion is enforced, not just checked once.
- Real brand colors are allowlisted: the Yoqa mark, third-party provider logos, and the Xcode badge (moved to `brand-marks.tsx`, deduplicating two copies).
- Theme-invariant surfaces (scrims over screenshots, code editors, boot splash) get tokens with one value in both themes; status colors get light/dark pairs.
- Rejected: migrating third-party brand colors to tokens (would dilute the logos).

## What shipped

- New tokens in `packages/ui/src/styles.css`: `warning-container`, `info-container` (light + dark), `scrim`, `code`, `splash*`.
- Doctor/status pills and rows, the Inspector info pill, the test-case tip card, code panes, screenshot overlays, the run video backdrop, the boot splash and the sidebar's white accents now use tokens.
- Muted dark variant of `.blob-actions`; the active nav pill derives from `--color-sidebar-fg`.

## How to verify

```bash
bun test apps/desktop/src/mainview/no-hardcoded-colors.test.ts
```

Then run the desktop app in both themes and walk Test Cases, Runs, Inspector, Configuration, Settings, the dropdowns and toasts.

## Follow-ups

- The screenshot sweep (light vs dark, every screen and modal) is not done; it needs the running desktop app.
- Provider swatch/dot colors (`bg-*-500` mid-tones) are left as-is; check contrast in dark during the sweep.
