# Buy me a coffee on README + Mintlify

## Goal

Surface support for Yoqa via Buy Me a Coffee on the GitHub repo page and the public Mintlify docs (`yoqa.arisn.dev`), including the provided QR code.

## Plan summary

- **Both surfaces:** README cannot run the BMC `<script>` (GitHub strips it); Mintlify can via a content-directory `.js` injector.
- **One QR asset** under `apps/docs/images/` so Mintlify and the README share the same file.
- Rejected: GitHub Pages-only page (repo has no Pages site); duplicating the PNG under `docs/assets/`.

## What shipped

- [`README.md`](../../README.md) — Support section with BMC badge + sized QR linking to `buymeacoffee.com/arisn`
- [`apps/docs/buy-me-a-coffee.js`](../../apps/docs/buy-me-a-coffee.js) — injects the official BMC button widget on every docs page (re-runs on `mintlify:navigate`)
- [`apps/docs/docs/overview.mdx`](../../apps/docs/docs/overview.mdx) — Support section with QR
- [`apps/docs/docs.json`](../../apps/docs/docs.json) — footer link “Buy me a coffee”
- [`apps/docs/images/buy-me-a-coffee-qr.png`](../../apps/docs/images/buy-me-a-coffee-qr.png) — QR asset

## How to verify

1. On the PR / branch README preview: badge and QR open https://www.buymeacoffee.com/arisn
2. `bun run docs` → Overview shows the Support section + QR; yellow BMC button appears after the widget script loads
3. Footer shows Support → Buy me a coffee

## Follow-ups

none
