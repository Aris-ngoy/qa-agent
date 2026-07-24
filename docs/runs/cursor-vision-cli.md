# Cursor vision via Agent CLI

## Goal

Let the Cursor Settings provider drive vision runs (decide + grounding), not only Settings auth/probe.

## Plan summary

- Cursor has no AI SDK `LanguageModel` path — mirror Antigravity: write screenshot to a temp workspace and invoke `cursor-agent --print`.
- Use `--mode ask` (read-only), `--trust` / `--force` (headless), `--workspace` = temp dir with only the shot.
- Auth: CLI login or `CURSOR_API_KEY` (same as driver validate). Default model: Settings value or `auto`.

Rejected: `@cursor/sdk`, community OpenAI proxies.

## What shipped

- [`cursor-decide.ts`](../../services/runner/src/domains/providers/cursor-decide.ts) — `decideWithCursorCli`, `groundWithCursorCli`
- [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts) — `cursor` in `VISION_KINDS` / auth gates; `createVisionModel` refuses cursor
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) / [`grounding.ts`](../../services/runner/src/domains/devices/grounding.ts) — branch to CLI
- Desktop copy + docs updates for Cursor vision

## How to verify

1. `cd services/runner && bun run check`
2. Settings → Cursor enabled + validated + default
3. Run a test case from the Runs panel; steps should decide via Cursor
4. Optional: yoqa grounding with `--description` while Cursor is default

## Follow-ups

- Stream Cursor output into the live run UI
- None required for MVP decide/ground
