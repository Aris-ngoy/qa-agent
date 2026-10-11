# Dark theme

## Goal

Let users switch the desktop app between Light, Dark and System from Settings → Appearance, with no light flash on launch (ticket #277, parent #275).

## Plan summary

- Theme is a `data-theme` attribute on `<html>`; `color-scheme` follows it so scrollbars and form controls match.
- Dark tokens live in `packages/ui/src/styles.css` (HeroUI semantic tokens + Tailwind `--color-*` tokens).
- Persistence and resolution reuse `ui-preferences.ts` ([ui-preferences.md](ui-preferences.md)).
- Rejected: a React context provider — a small external store keeps Settings and the app-root sync in step without extra nesting.

## What shipped

- `apps/desktop/index.html`: inline script applies the saved mode (or the OS preference) before first paint.
- `apply-theme.ts`: `applyTheme(root, mode, osPrefersDark)` — the unit-tested seam.
- `use-theme-mode.tsx`: shared mode store, `useThemeMode`, and `ThemeSync` (mounted in `main.tsx`) which follows OS changes live under System.
- Settings: Appearance is the first section and the default tab, with a Light / Dark / System control.
- `.dashboard-canvas` gets a dark gradient.

## How to verify

```bash
bun test apps/desktop/src/mainview/features/settings/apply-theme.test.ts
```

Run the desktop app: pick Dark in Settings → Appearance; relaunch (no flash); pick System and flip the OS appearance.

## Follow-ups

- Audit remaining hard-coded light colors (`bg-white`, brand gradients, `blob-actions`, `card-*` pastels) and verify contrast in dark.
- Sync theme across windows via the `storage` event; add tests for the pre-paint script.
- The inline script duplicates the storage key from `ui-preferences.ts`; keep in sync.
