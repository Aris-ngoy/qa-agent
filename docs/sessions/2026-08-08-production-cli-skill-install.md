# Production CLI & skill install (packaged resources)

## Goal

Fix Settings → CLI & Agents install/reinstall failing in production releases with “Could not find yoqa CLI entrypoint” / missing `packages/skill/yoqa-testing`.

## Plan summary

- Root cause: install only resolved monorepo TypeScript paths; DMG never shipped CLI or skill sources.
- Ship a compiled `yoqa` CLI binary beside `yoqa-runner`, plus a skill tarball under Resources.
- Settings prefers packaged paths; Bun + checkout remain the dev fallback.

## What shipped

- `apps/desktop/scripts/build-runner-sidecar.ts` — also compiles CLI and packs skill archive
- `electrobun.config.ts` — copy + asarUnpack for `runner/yoqa` and `skills/yoqa-testing.tar.gz`
- `cli-environment` — packaged-first resolve; wrapper execs binary in production
- Shared `packaged-resources` helpers for candidate paths
- Docs: `docs/desktop/macos-release.md`, `docs/desktop/cli-and-agents.md`

## How to verify

1. `cd apps/desktop && bun scripts/build-runner-sidecar.ts`
2. Confirm `resources/runner/yoqa` and `resources/skills/yoqa-testing.tar.gz` exist; `./resources/runner/yoqa --help` works
3. Cut/build a release (`bun run desktop:release`), open the `.app` outside the repo
4. Settings → CLI & Agents → Reinstall CLI and skill — no monorepo errors; `yoqa health` works with the runner up

## Follow-ups

- Uninstall buttons (still open from CLI & Agents doc)
