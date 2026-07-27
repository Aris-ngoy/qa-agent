# YoQA testing skill

## Goal

Ship the full `yoqa-testing` agent skill in this repo so coding agents can follow inspect → act → verify and test-management workflows via the `yoqa` CLI.

## Plan summary

- Full skill tree (18 markdown files), not a Phase-1 trim.
- CLI/product/docs URLs branded for YoQA; keep target CLI surface from ARCHITECTURE even where not all commands are implemented yet.
- Dual destination: Cursor-local `.agents/skills/yoqa-testing` and packaged `packages/skill/yoqa-testing`.
- Startup rules use this repo’s runner + desktop split (`bun run runner` / `health` / `desktop`).

## What shipped

- [`.agents/skills/yoqa-testing/`](../../.agents/skills/yoqa-testing/) — full skill tree (`SKILL.md`, `workflows/`, `concepts/`, `references/`)
- [`packages/skill/yoqa-testing/`](../../packages/skill/yoqa-testing/) — identical content
- Frontmatter `name: yoqa-testing`; startup rules point at local Bun runner/desktop

## How to verify

```bash
diff -rq .agents/skills/yoqa-testing packages/skill/yoqa-testing
```

Open either `SKILL.md` and confirm workflows link to relative `references/` / `concepts/` paths.

## Follow-ups

- Wire skill install into desktop Settings (ARCHITECTURE §2.1 / §2.9) when shipping the app.
- Update skill docs as `yoqa` CLI gains `screen` / `action` / `apps` / `cases` / `runs` (and drop aspirational commands that diverge).
- Confirm `https://docs.yoqa.ai/llms.txt` exists when docs site is live.
