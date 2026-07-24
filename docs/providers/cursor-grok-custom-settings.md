# Cursor, Grok, and Custom Settings providers

## Goal

Promote Cursor and Grok from Settings “Coming soon”, and add a Custom OpenAI-compatible provider for local/gateway endpoints. Cursor vision later ships via Agent CLI (same pattern as Antigravity).

## Plan summary

| Kind | Auth | Vision |
|------|------|--------|
| **cursor** | Cursor Agent CLI (`cursor-agent`) + optional `CURSOR_API_KEY` | Yes via `cursor-agent --print` (ask / headless) |
| **grok** | xAI API key (`XAI_API_KEY`) | Yes via `@ai-sdk/xai` |
| **custom** | Optional API key + required Base URL | Yes via `createOpenAI` + custom `baseURL` |

Rejected: inventing a `grok` CLI; `@cursor/sdk` / OpenAI-compatible proxies for Cursor.

## What shipped

**Schema:** `cursor`, `grok`, `custom` in [`packages/runner-client/src/schemas.ts`](../../packages/runner-client/src/schemas.ts)

**Drivers:** [`cursor.ts`](../../services/runner/src/domains/providers/drivers/cursor.ts), [`grok.ts`](../../services/runner/src/domains/providers/drivers/grok.ts), [`custom.ts`](../../services/runner/src/domains/providers/drivers/custom.ts)

**Probe:** [`pingOpenAiCompatible`](../../services/runner/src/domains/providers/drivers/probe.ts) supports `allowEmptyApiKey` for local hosts

**Vision:**
- Grok + Custom in [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts); dep `@ai-sdk/xai`
- Cursor CLI decide + grounding in [`cursor-decide.ts`](../../services/runner/src/domains/providers/cursor-decide.ts) (`--mode ask --trust --force --workspace <tmpdir>`)

**Desktop:** Cursor / Grok / Custom active cards; Base URL field on Add + Expanded for Custom

## How to verify

1. Restart desktop / runner sidecar.
2. Settings → Providers → Add → **Cursor**, **Grok**, **Custom** selectable.
3. Cursor: CLI login → Validate → email / models list → set as default → run a vision case.
4. Grok: paste `XAI_API_KEY` → Validate → set as default → run a vision case.
5. Custom: Base URL e.g. `http://127.0.0.1:11434/v1` → Validate → set default model → vision run.
6. `cd services/runner && bun run check`

## Follow-ups

- Stream Cursor Agent tokens into the live run UI
- ACP / Pi coming-soon cards
- Optional: Antigravity CLI grounding (decide already works; grounding still needs AI Studio key today)
