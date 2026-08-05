# Smaller side menu + docs link

## Goal

Make the desktop side menu a bit narrower and point Docs (and related Help / in-app links) at the public docs site so users can read documentation in the browser.

## Plan summary

- Shrink via shared `--spacing-sidebar` token plus tighter padding/chrome in the side menu — no nav restructuring
- Switch hardcoded Mintlify preview host (`yoqa.mintlify.site`) to production `https://docs.yoqa.ai`
- Leave README alone; focus desktop UX links

## What shipped

- [`packages/ui/src/styles.css`](../../packages/ui/src/styles.css): `--spacing-sidebar` 260px → 220px
- [`apps/desktop/src/mainview/app/side-menu.tsx`](../../apps/desktop/src/mainview/app/side-menu.tsx): tighter padding, logo, nav rows, add-app control; Docs → `https://docs.yoqa.ai`
- [`apps/desktop/src/bun/index.ts`](../../apps/desktop/src/bun/index.ts): Help → Documentation opens `https://docs.yoqa.ai`
- [`apps/desktop/src/mainview/features/test-cases/detail-page.tsx`](../../apps/desktop/src/mainview/features/test-cases/detail-page.tsx): writing-guide link host updated

## How to verify

1. Run the desktop app and confirm the sidebar is narrower (~220px) with slightly denser chrome.
2. Click **Docs** in the side menu footer — browser opens `https://docs.yoqa.ai`.
3. macOS menu **Help → Documentation** opens the same site.
4. On a test case detail page, the writing-guide link opens `https://docs.yoqa.ai/guide/writing-test-cases`.

## Follow-ups

- Align README quickstart link with `docs.yoqa.ai` when convenient
- None required for sidebar density unless visual QA asks for further tweaks
