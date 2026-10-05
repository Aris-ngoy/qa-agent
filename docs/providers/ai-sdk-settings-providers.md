# Expanded Settings providers (AI SDK)

## Goal

Expose Groq, Google, Google Vertex, and **Antigravity** (`agy`, replaces Gemini CLI) in Settings, with vision via official AI SDK packages (Zod 3–compatible) or the Antigravity CLI print path.

## Plan summary

- Extend closed `ProviderKind` union; add runner drivers + Settings cards.
- Vision via `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, plus Anthropic / OpenAI / OpenCode Zen.
- **Antigravity:** probe/`agy models` for Settings (`id<TAB>display name` — only the id is stored/passed to `--model`); vision via `agy --print` (screenshot file path in prompt) or Google AI Studio API key fallback when the account is not eligible. Default vision model: `gemini-3.8-flash-medium`.
- Legacy DB kind `gemini-cli` is remapped to `antigravity` on read.

## What shipped

**Schema:** `groq`, `google`, `google-vertex`, `antigravity` in [`packages/runner-client/src/schemas.ts`](../../packages/runner-client/src/schemas.ts)

**Deps:** `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/google-vertex`

**Drivers:** groq, google, google-vertex, [`antigravity.ts`](../../services/runner/src/domains/providers/drivers/antigravity.ts)

**Vision:** [`vision.completeObject`](../../services/runner/src/domains/providers/drivers/types.ts) on each adapter; Antigravity CLI in [`antigravity-vision.ts`](../../services/runner/src/domains/providers/drivers/antigravity-vision.ts)

**Antigravity model ids:** [`antigravity-models.ts`](../../services/runner/src/domains/providers/drivers/antigravity-models.ts) parses `agy models` TSV so Settings stores `gemini-3.8-flash-low`, not `gemini-3.8-flash-low<TAB>Gemini 3.8 Flash (Low)`. Vision also strips a leftover tab/name from an already-saved default before `--model`.

## How to verify

1. Settings → Providers → Add **Antigravity** (not Gemini CLI).
2. With `agy` on PATH: Validate → models list shows display names, stored/passed id is the first column only (no tab).
3. Run a case: eligible Antigravity account uses `agy --print --model <id>`; otherwise paste Google AI Studio key or use Google provider.
4. Re-pick the default model if an older provider still shows a tabbed value — runs still heal it.
5. `cd services/runner && bun run check`

## Follow-ups

- Upgrade to Zod 4 for Codex CLI OAuth package
- Richer Antigravity image input if/when `agy` adds a native image flag
