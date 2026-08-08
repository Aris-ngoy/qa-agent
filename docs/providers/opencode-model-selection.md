# OpenCode free / paid model selection

## Goal

Stop OpenCode runs from failing with Zen `CreditsError` (no payment method) or text-only model errors by defaulting to a free **vision-capable** model, and let users pick Free vs Paid models from OpenCode provider details.

## Plan summary

- Zen `GET /models` returns ids only — no pricing or vision metadata — so classify free models locally (`*-free` suffix + known ids like `big-pickle`).
- Default OpenCode runs to `mimo-v2.5-free` (verified Aug 2026 to accept screenshot `image_url` and return visible content).
- Replace the OpenCode free-text + flat model list with a Free / Paid grouped Select.
- Rejected: embedding billing UI in YoQA; filtering to free-only (paid remains selectable when the user has credits); assuming all free models support vision.

## What shipped

- **Schema:** optional `tier: "free" | "paid"` on `ModelEntry` / `providerModelSchema`.
- **Driver:** [`services/runner/src/domains/providers/drivers/opencode.ts`](../../services/runner/src/domains/providers/drivers/opencode.ts) tags and humanizes models when listing; default `mimo-v2.5-free`.
- **Runs:** clearer messages for `CreditsError`, text-only `image_url` 400s, and opaque vision failures.
- **UI:** OpenCode details show Free/Paid models; hint that YoQA needs screenshot-capable models.

## Auth note

Vision uses **hosted Zen** (`opencode.ai/zen/v1`) with an OpenAI-compatible client.

- **Zen API key (required for vision):** Settings paste / `OPENCODE_API_KEY` / CLI `auth.json`
- **CLI login alone is not enough for YoQA vision:** local `opencode serve` exposes a native session API, not `/v1/chat/completions`
- **Base URL:** optional OpenAI-compatible proxy; do not point Server URL at `opencode serve` expecting OpenAI `/v1`

See [2026-08-08-opencode-zen-not-local-serve](../sessions/2026-08-08-opencode-zen-not-local-serve.md).

## How to verify

1. Settings → Provider → expand OpenCode (with API key) → Free / Paid list → click `mimo-v2.5-free` → Save.
2. Run a test case → agent receives a 200 from Zen with a screenshot attached.
3. Clear `defaultModel` on the provider → agent uses `mimo-v2.5-free`.
4. Select a paid model without billing → CreditsError message points at Settings / billing.
5. Select `deepseek-v4-flash-free` → clear error that the model is text-only; switch to `mimo-v2.5-free`.

## Known upstream quirk

Most Zen free models are **text-only** and reject `image_url` (HTTP 400 `unknown variant image_url` or “No endpoints found that support image input”). Reproduced for `deepseek-v4-flash-free`, `big-pickle`, `laguna-s-2.1-free`, `north-mini-code-free`, `nemotron-3-ultra-free`, `ling-3.0-tiny-free`. `mimo-v2.5-free` accepts vision. `longcat-2.0-free` accepts the request but often ignores the image.

Paid multimodal models (Gemini / Claude / GPT on Zen) need billing and may use different Zen endpoints (`/messages`, `/responses`, Gemini generateContent) — YoQA currently talks OpenAI chat-completions style against `/zen/v1`.

## Follow-ups

- If Zen adds pricing / modality fields to `/models`, prefer API metadata over local heuristics.
- Optionally warn when an existing provider still has a non-vision `defaultModel` (proactive UI banner).
- Route Claude/Gemini/GPT Zen models through their documented endpoints if we want paid vision without chat-completions quirks.
