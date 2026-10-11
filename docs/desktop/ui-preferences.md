# UI preferences

## Goal

Give the desktop theme (Light / Dark / System) and side-menu collapsed state one
storage-backed module that is the single unit-test seam for the feature (parent #275, ticket #276).

## Plan summary

- Mirror the device-session storage pattern in `session-device.ts`: injected `Storage`, reads and writes that never throw.
- Keep the module free of UI wiring; the theme and side-menu work consume it later.
- Rejected: sharing a storage helper with `session-device.ts` now (would touch the devices feature).

## What shipped

`apps/desktop/src/mainview/features/settings/ui-preferences.ts`:

- `readThemeMode` / `writeThemeMode` — default `system`; invalid values fall back to it.
- `readSidebarCollapsed` / `writeSidebarCollapsed` — default expanded.
- `resolveTheme(mode, osPrefersDark)` — explicit modes win; `system` follows the OS.

## How to verify

```bash
bun test apps/desktop/src/mainview/features/settings/ui-preferences.test.ts
```

## Follow-ups

- Wire the module into the theme provider and side menu (rest of #275).
- Possibly extract a shared tolerant-storage helper with `session-device.ts`.
