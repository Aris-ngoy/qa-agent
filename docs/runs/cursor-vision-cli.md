# Cursor vision via Agent CLI

## Goal

Let the Cursor Settings provider drive vision runs (decide + grounding), not only Settings auth/probe.

## Plan summary

- Cursor has no AI SDK `LanguageModel` path — mirror Antigravity: write screenshot to a temp workspace and invoke `cursor-agent --print`.
- Use `--mode ask` (read-only), `--trust` / `--force` (headless), `--workspace` = temp dir with only the shot.
- Auth: CLI login or `CURSOR_API_KEY` (same as driver validate). Default model: Settings value or `auto`.

Rejected: `@cursor/sdk`, community OpenAI proxies.

## What shipped

- [`cursor-vision.ts`](../../services/runner/src/domains/providers/drivers/cursor-vision.ts) — Cursor adapter `completeObject` via `cursor-agent --print`
- [`vision.ts`](../../services/runner/src/domains/providers/vision.ts) — `resolveVision` / `completeVision` (no kind switch)
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) / [`grounding.ts`](../../services/runner/src/domains/devices/grounding.ts) — call `completeVision`
- Desktop copy + docs updates for Cursor vision

## How to verify

1. `cd services/runner && bun run check`
2. Settings → Cursor enabled + validated + default
3. Run a test case from the Runs panel; steps should decide via Cursor
4. Optional: yoqa grounding with `--description` while Cursor is default

## Follow-ups

- Stream Cursor output into the live run UI
- Loose JSON from Cursor (single quotes / trailing commas) is coerced in `agent-json.ts`; repair retry also covers `invalid JSON`
