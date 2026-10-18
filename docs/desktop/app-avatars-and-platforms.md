# App avatars and platform icons

## Goal

Tell applications apart in the side menu's workspace picker. Every avatar used to be the same
yellow tile, and nothing showed what an app runs on.

## Plan summary

- **Color per app, stable and distinct.** An app's color comes from a hash of its id (FNV-1a),
  so it survives reloads and renames. On a clash it moves to the next free palette slot, so apps
  in the list never share a color until the 14-color palette runs out. Rejected: true random
  colors (change on every render) and colors by list position (shift when apps are deleted).
- **Theme-safe colors.** The palette uses Tailwind 600/700 shades dark enough for white
  initials in both themes. White comes from a new `--color-on-avatar` token in
  `packages/ui/src/styles.css`, so the no-hardcoded-colors guard stays green.
- **Platform rule.** A web icon when the app has a web URL. Otherwise an Android icon for an
  Android application id and an Apple icon for an iOS bundle id or App Store id (both when it
  has both). No icon when nothing is configured.

## What shipped

- `features/apps/utils/app-badge.ts`: `appInitials` (moved from the side menu),
  `appAvatarColors`, and `appPlatforms`, with unit tests.
- `features/apps/components/app-badge.tsx`: `AppAvatar` and `AppPlatformIcons`. The icons carry a
  title and screen-reader text ("Web", "Android", "iOS").
- `app/side-menu.tsx`: the picker rows and the collapsed workspace tile use the app's color, and
  each row shows its platform icons on the right.

## How to verify

1. `cd apps/desktop && bun test src/mainview/features/apps`
2. Run the app (or the e2e harness: `bun e2e/start-runner.ts` and
   `bunx vite --config vite.e2e.config.ts`). Add apps with a web URL, an Android id, an iOS
   bundle id, both, and none.
3. Open the workspace picker: each app has its own color, web apps show a globe, mobile apps
   show Android and/or Apple icons, and unconfigured apps show none. Check light and dark.

## Follow-ups

None.
