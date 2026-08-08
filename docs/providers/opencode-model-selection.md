# OpenCode free / paid model selection

## Goal

Stop OpenCode runs from failing with Zen `CreditsError` (no payment method) or opaque vision `500`s by defaulting to a free **vision-capable** model, and let users pick Free vs Paid models from OpenCode provider details.

## Plan summary

- Zen `GET /models` returns ids only — no pricing or vision metadata — so classify free models locally (`*-free` suffix + known ids like `big-pickle`).
- Default OpenCode runs to `deepseek-v4-flash-free` (verified to accept screenshot `image_url` payloads).
- Replace the OpenCode free-text + flat model list with a Free / Paid grouped Select.
- Rejected: embedding billing UI in YoQA; filtering to free-only (paid remains selectable when the user has credits); assuming all free models support vision.

## What shipped

- **Schema:** optional `tier: "free" | "paid"` on `ModelEntry` / `providerModelSchema`.
- **Driver:** [`services/runner/src/domains/providers/drivers/opencode.ts`](../../services/runner/src/domains/providers/drivers/opencode.ts) tags and humanizes models when listing.
- **Runs:** [`services/runner/src/domains/runs/agent.ts`](../../services/runner/src/domains/runs/agent.ts) defaults OpenCode to `deepseek-v4-flash-free`; clearer messages for `CreditsError` and opaque vision `500`s.
- **UI:** OpenCode details show Free/Paid models; hint that YoQA needs screenshot-capable models. New providers default to `deepseek-v4-flash-free`.

## Auth note

Vision can use either path (T3 Code style CLI is the default):

- **CLI login:** install OpenCode, run `opencode providers login` — YoQA spawns `opencode serve` for vision (no Zen key paste required)
- **Zen API key:** Settings paste / `OPENCODE_API_KEY` / `auth.json` against `opencode.ai/zen`
- **External Server URL:** point at an already-running serve (+ `OPENCODE_SERVER_PASSWORD` for Basic auth)

See [2026-08-08-opencode-auth-fix](../sessions/2026-08-08-opencode-auth-fix.md).

## How to verify

1. Settings → Provider → expand OpenCode (with API key) → Free / Paid list appears → click `deepseek-v4-flash-free` → Save.
2. Run a test case with that provider → agent receives a 200 from Zen (not opaque Internal server error).
3. Clear `defaultModel` on the provider → agent uses `deepseek-v4-flash-free`.
4. Select a paid model without billing → CreditsError message points at Settings / billing.
5. Select `north-mini-code-free` (or `big-pickle`) and run → error message suggests switching to a vision-capable free model.

## Known upstream quirk

Many Zen free models accept **text** but return HTTP 500 `Internal server error` on `image_url` (screenshots). Reproduced for `north-mini-code-free`, `big-pickle`, `laguna-s-2.1-free`, `nemotron-3-ultra-free`. `deepseek-v4-flash-free` accepts vision.

## Follow-ups

- If Zen adds pricing / modality fields to `/models`, prefer API metadata over local heuristics.
- Optionally warn when an existing provider still has a non-vision `defaultModel` (proactive UI banner).
