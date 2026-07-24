# Vision inference via AI SDK

## Goal

Replace hand-rolled Anthropic / OpenAI-compatible `fetch` clients in the vision decide loop (and description grounding) with [Vercel AI SDK](https://ai-sdk.dev/docs/foundations/providers-and-models) so provider switching and structured action JSON share one path.

## Plan summary

- Keep BYO Settings/drivers (probe, secrets, model catalog) unchanged — AI SDK is only the inference adapter.
- Map `ActiveProviderAuth` → `LanguageModel` via `createAnthropic` / `createOpenAI(...).chat(...)`.
- Use `generateObject` + Zod schemas for agent decisions and grounding coords.
- Preserve OpenCode quirks: Zen base URL, CLI `auth.json` key, `thinking: { type: "disabled" }` via custom fetch, screenshot downscale, friendly CreditsError / non-vision 500 messages.

Rejected for this pass: redesigning provider drivers around AI SDK; CLI-only vision (Claude/Codex).

## What shipped

**Deps (`@yoqa/runner`)**
- `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`

**Runner**
- [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts) — key/baseURL resolution, `createVisionModel`, `assertVisionCapableProvider`, OpenCode error formatting
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) — `decideNextAction` via `generateObject`; keeps `prepareVisionImage` + repair retry
- [`grounding.ts`](../../services/runner/src/domains/devices/grounding.ts) — same factory + `generateObject` for `{x,y}`

## How to verify

1. `cd services/runner && bun run check`
2. Configure Anthropic, OpenAI, or OpenCode (API key) as default enabled provider.
3. Run a test case from the desktop Runs panel; steps should still decide via vision.
4. Optional: `yoqa` grounding with `--description` still resolves coords.

## Follow-ups

- Prefer `generateText` + `Output.object` when dropping deprecated `generateObject`
- Stream model tokens into the live run UI
- Vision for remaining CLI-only adapters if needed (Codex CLI OAuth still blocked on Zod 4)
- Cursor vision uses Agent CLI (`cursor-decide.ts`), not AI SDK — see [cursor-grok-custom-settings.md](../providers/cursor-grok-custom-settings.md)
