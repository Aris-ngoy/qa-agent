# YoQA Mintlify docs site

## Goal

Ship a public product docs site (Mintlify IA: Docs + Guide tabs) branded for YoQA, covering Phase 1 local features.

## Plan summary

- Stack: **Mintlify** (`docs.json`, MDX) at [`apps/docs`](../../apps/docs)
- Keep engineering notes in repo-root [`docs/`](../) separate from the public site
- Omit Cloud / Public API tabs until those surfaces ship
- Isolate Mintlify from Bun workspaces (React hoist conflicts with desktop)

## What shipped

- `apps/docs/docs.json` — YoQA branding (teal), Docs + Guide tabs, redirects `/` → `/docs/overview`
- Docs pages: overview, quickstart, apps, test-cases, desktop-app, local-builds, device-preparation, cli, manual-inspector, providers
- Guide pages: introduction, how-yoqa-agent-works, writing-test-cases, local-testing, cli-for-agents, and best-practices set
- Logos / favicon SVGs; root script `bun run docs`
- Workspaces list uses `apps/desktop` (not `apps/*`) so docs installs its own `mintlify`

## How to verify

```bash
cd apps/docs && bun install   # first time
bun run docs                  # from repo root → Mintlify preview
# open http://localhost:3000/docs/overview (or the port printed by mintlify)
```

Prefer Node 20–24 (see `apps/docs/.nvmrc`). Confirm sidebar groups, Overview steps/cards, and Guide tab.

## Follow-ups

- Connect Mintlify hosting + custom domain `docs.yoqa.ai` (skill already points at `llms.txt`)
- Product screenshots for desktop/inspector pages
- Cloud / CI / OpenAPI tabs when those features land
