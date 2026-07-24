# Expanded Settings providers (AI SDK)

## Goal

Expose Groq, Google, Google Vertex, and **Antigravity** (`agy`, replaces Gemini CLI) in Settings, with vision via official AI SDK packages (Zod 3–compatible) or the Antigravity CLI print path.

## Plan summary

- Extend closed `ProviderKind` union; add runner drivers + Settings cards.
- Vision via `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, plus Anthropic / OpenAI / OpenCode Zen.
- **Antigravity:** probe/`agy models` for Settings; vision via `agy --print` (screenshot file path in prompt) or Google AI Studio API key fallback when the account is not eligible.
- Legacy DB kind `gemini-cli` is remapped to `antigravity` on read.

## What shipped

**Schema:** `groq`, `google`, `google-vertex`, `antigravity` in [`packages/runner-client/src/schemas.ts`](../../packages/runner-client/src/schemas.ts)

**Deps:** `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/google-vertex`

**Drivers:** groq, google, google-vertex, [`antigravity.ts`](../../services/runner/src/domains/providers/drivers/antigravity.ts)

**Vision:** [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts), [`antigravity-decide.ts`](../../services/runner/src/domains/providers/antigravity-decide.ts)

## How to verify

1. Settings → Providers → Add **Antigravity** (not Gemini CLI).
2. With `agy` on PATH: Validate → models list from `agy models`.
3. Run a case: eligible Antigravity account uses `agy --print`; otherwise paste Google AI Studio key or use Google provider.
4. `cd services/runner && bun run check`

## Follow-ups

- Upgrade to Zod 4 for Codex CLI OAuth package
- Richer Antigravity image input if/when `agy` adds a native image flag
