# YoQA testing skill (copy + rebrand)

## Goal

Port the full `noqa-testing` agent skill into this repo, rebranded for YoQA, so coding agents can follow inspect → act → verify and test-management workflows via the `yoqa` CLI.

## Plan summary

- Full copy of the noqa skill (18 markdown files), not a Phase-1 trim.
- Rebrand CLI/product/docs URLs to YoQA; keep target CLI surface from ARCHITECTURE even where not all commands are implemented yet.
- Dual destination: Cursor-local `.agents/skills/noqa-testing` and packaged `packages/skill/yoqa-testing`.
- Replace noqa’s “open the app only” startup rule with this repo’s runner + desktop split (`bun run runner` / `health` / `desktop`).

## What shipped

- [`.agents/skills/noqa-testing/`](../../.agents/skills/noqa-testing/) — full skill tree (`SKILL.md`, `workflows/`, `concepts/`, `references/`)
- [`packages/skill/yoqa-testing/`](../../packages/skill/yoqa-testing/) — identical content (overwrote prior stubs)
- Frontmatter `name: yoqa-testing`; startup rules point at local Bun runner/desktop
- Zero remaining `noqa` strings in either tree

## How to verify

```bash
diff -rq .agents/skills/noqa-testing packages/skill/yoqa-testing
rg -i 'noqa' .agents/skills/noqa-testing packages/skill/yoqa-testing   # expect no matches
```

Open either `SKILL.md` and confirm workflows link to relative `references/` / `concepts/` paths.

## Follow-ups

- Wire skill install into desktop Settings (ARCHITECTURE §2.2 / §2.9) when shipping the app.
- Update skill docs as `yoqa` CLI gains `screen` / `action` / `apps` / `cases` / `runs` (and drop aspirational commands that diverge).
- Confirm `https://docs.yoqa.ai/llms.txt` exists when docs site is live.
