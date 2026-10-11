# Collapsible side menu

## Goal

Collapse the side menu to a ~64px icon rail and back from a top-bar toggle or ⌘B, remembered across launches (ticket #278, parent #275).

## Plan summary

- Collapsed state lives in a small external store (`sidebar-store.ts`) over the `ui-preferences` storage helpers; it is the unit-tested seam.
- One `collapsed` flag drives the existing `SideMenu` markup instead of a second rail component, so nav items and the Workspace dropdown are shared.
- Rejected: a separate rail component (would duplicate nav and dropdown logic).

## What shipped

- `sidebar-store.ts` / `use-sidebar-collapsed.ts`: store, hook and ⌘B (Ctrl+B off macOS) listener; `SidebarShortcut` is mounted in `main.tsx`.
- `sidebar-toggle.tsx`: button in the side menu (expanded header, or under the wordmark when collapsed) with `aria-expanded`, `aria-controls` and a state-aware label. ⌘B still toggles it.
- `side-menu.tsx`: a dark card in both themes (`bg-sidebar`, the shared `--radius`, 244px expanded, 68px collapsed), with the Yoqa mark. The active item is a static rounded rectangle with a violet icon. Collapsed state shows icon-only items with right-side tooltips, a two-letter Workspace tile that still opens the app-switch dropdown (including Add application), a Docs icon, and a dot on the Runs icon while a run is live. Labels stay as `sr-only` text so icons keep accessible names. Width animates with the existing motion tokens (disabled under reduced motion).

## How to verify

```bash
bun test apps/desktop/src/mainview/features/settings/sidebar-store.test.ts
```

In the app: press ⌘B or use the toggle in the side menu, relaunch (state persists), start a run (dot on Runs), switch pages in both states.

## Follow-ups

- Manual pass in the running app (not yet done): tooltips, focus rings, rail visuals.
- ⌘B also fires while typing in a field; revisit if it conflicts with text editing.
