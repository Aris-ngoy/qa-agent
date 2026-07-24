# Cursor, Grok, and Custom Settings providers

## Goal

Promote Cursor and Grok from Settings “Coming soon”, and add a Custom OpenAI-compatible provider for local/gateway endpoints.

## Plan summary

| Kind | Auth | Vision |
|------|------|--------|
| **cursor** | Cursor Agent CLI (`cursor-agent`) + optional `CURSOR_API_KEY` | No (no AI SDK chat path) |
| **grok** | xAI API key (`XAI_API_KEY`) | Yes via `@ai-sdk/xai` |
| **custom** | Optional API key + required Base URL | Yes via `createOpenAI` + custom `baseURL` |

Rejected: inventing a `grok` CLI; wiring Cursor Agent into vision this pass.

## What shipped

**Schema:** `cursor`, `grok`, `custom` in [`packages/runner-client/src/schemas.ts`](../../packages/runner-client/src/schemas.ts)

**Drivers:** [`cursor.ts`](../../services/runner/src/domains/providers/drivers/cursor.ts), [`grok.ts`](../../services/runner/src/domains/providers/drivers/grok.ts), [`custom.ts`](../../services/runner/src/domains/providers/drivers/custom.ts)

**Probe:** [`pingOpenAiCompatible`](../../services/runner/src/domains/providers/drivers/probe.ts) supports `allowEmptyApiKey` for local hosts

**Vision:** Grok + Custom in [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts); dep `@ai-sdk/xai`

**Desktop:** Cursor / Grok / Custom active cards; Base URL field on Add + Expanded for Custom

## How to verify

1. Restart desktop / runner sidecar.
2. Settings → Providers → Add → **Cursor**, **Grok**, **Custom** selectable.
3. Cursor: CLI login → Validate → email / models list.
4. Grok: paste `XAI_API_KEY` → Validate → set as default → run a vision case.
5. Custom: Base URL e.g. `http://127.0.0.1:11434/v1` → Validate → set default model → vision run.
6. `cd services/runner && bun run check`

## Follow-ups

- Cursor Agent → vision / AI SDK language model when a stable API exists
- ACP / Pi coming-soon cards
