# Smaller side menu + docs link

## Goal

Make the desktop side menu a bit narrower and point Docs (and related Help / in-app links) at the public docs site so users can read documentation in the browser.

## Plan summary

- Shrink via shared `--spacing-sidebar` token plus tighter padding/chrome in the side menu — no nav restructuring
- Use the live Mintlify docs host: [`https://yoqa.mintlify.site/docs/quickstart`](https://yoqa.mintlify.site/docs/quickstart)

## What shipped

- [`packages/ui/src/styles.css`](../../packages/ui/src/styles.css): `--spacing-sidebar` 260px → 220px
- [`apps/desktop/src/mainview/app/side-menu.tsx`](../../apps/desktop/src/mainview/app/side-menu.tsx): tighter padding, logo, nav rows, add-app control; Docs → Mintlify quickstart
- [`apps/desktop/src/bun/index.ts`](../../apps/desktop/src/bun/index.ts): Help → Documentation opens the same quickstart URL
- [`apps/desktop/src/mainview/features/test-cases/detail-page.tsx`](../../apps/desktop/src/mainview/features/test-cases/detail-page.tsx): writing-guide link on Mintlify

## How to verify

1. Run the desktop app and confirm the sidebar is narrower (~220px) with slightly denser chrome.
2. Click **Docs** in the side menu footer — browser opens [https://yoqa.mintlify.site/docs/quickstart](https://yoqa.mintlify.site/docs/quickstart).
3. macOS menu **Help → Documentation** opens the same URL.
4. On a test case detail page, the writing-guide link opens `https://yoqa.mintlify.site/guide/writing-test-cases`.

## Follow-ups

- Switch links to `docs.yoqa.ai` when the custom domain is connected
- None required for sidebar density unless visual QA asks for further tweaks
