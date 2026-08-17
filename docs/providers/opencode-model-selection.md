# OpenCode model selection by provider

## Goal

Let users pick OpenCode models grouped the same way OpenCode does — **Amazon Bedrock**, **OpenCode Zen**, **LiteLLM**, **GitHub Copilot**, and other connected CLI providers — instead of a Free / Paid split. Yoqa vision should run against **OpenCode Zen** or an OpenAI-compatible OpenCode gateway such as **LiteLLM**.

## Plan summary

- `opencode models` prints `provider/model` slugs (`amazon-bedrock/amazon.nova-lite-v1:0`, `opencode/mimo-v2.5-free`, `litellm/claude-haiku-4-5`). Keep that prefix as the catalog id and group by provider.
- Prefer the CLI catalog over Zen `GET /models` so connected providers (Bedrock, Copilot, LiteLLM, …) appear even when a Zen API key is set. Zen-only listings still group as **OpenCode Zen**.
- Rejected: keeping Free / Paid as the primary accordion; inferring vendor from model name (GPT vs Claude) instead of OpenCode’s provider id; sending LiteLLM slugs to hosted Zen.
- Screenshot runs use hosted Zen (`opencode.ai/zen/v1`) for `opencode/…` models. LiteLLM (and other `opencode.json` OpenAI-compatible providers) use that provider’s `options.baseURL`. Bedrock / Copilot stay listed but are still rejected for vision.

## What shipped

- **Schema:** optional `provider` (display label) on `ModelEntry` / `providerModelSchema`; removed `tier: "free" | "paid"`.
- **Driver:** [`services/runner/src/domains/providers/drivers/opencode.ts`](../../services/runner/src/domains/providers/drivers/opencode.ts) parses CLI slugs, labels providers (Amazon Bedrock, OpenCode Zen, LiteLLM, …), and lists CLI models first.
- **Vision:**
  - Zen: strips `opencode/` and calls `opencode.ai/zen/v1`. Default remains `mimo-v2.5-free`.
  - LiteLLM: reads `provider.litellm` from `~/.config/opencode/opencode.json` (`baseURL`, `{env:…}` API key / headers) and the LiteLLM key from OpenCode `auth.json` or `LITELLM_API_KEY`. Does **not** reuse the Zen API key. Strips OpenAI `response_format` so Bedrock-backed LiteLLM models do not fail with `output_config.format: Extra inputs are not permitted`.
  - Amazon Bedrock / Copilot / other native CLI providers: actionable error to pick Zen or LiteLLM.
- **UI:** OpenCode details accordion groups by OpenCode provider. LiteLLM selection explains gateway routing instead of telling the user to switch to Zen. Existing bare ids (`mimo-v2.5-free`) still match `opencode/mimo-v2.5-free`.

## Auth note

**OpenCode Zen** uses hosted Zen (`opencode.ai/zen/v1`) with an OpenAI-compatible client.

- **Zen API key (required for Zen vision):** Settings paste / `OPENCODE_API_KEY` / CLI `auth.json` `opencode` entry
- **CLI login alone is not enough for Zen:** local `opencode serve` exposes a native session API, not `/v1/chat/completions`

**LiteLLM** uses the OpenCode-configured gateway:

- **Config:** `~/.config/opencode/opencode.json` → `provider.litellm.options.baseURL` (and optional headers such as `x-litellm-end-user-id`)
- **Key:** OpenCode `auth.json` `litellm` entry, interpolated `{env:LITELLM_API_KEY}`, or Settings env `LITELLM_API_KEY`
- **Do not** point Server URL at `opencode serve` expecting OpenAI `/v1`

See [2026-08-08-opencode-zen-not-local-serve](../sessions/2026-08-08-opencode-zen-not-local-serve.md).

## How to verify

1. Settings → Provider → expand OpenCode (CLI on PATH) → model picker shows OpenCode Zen, LiteLLM, Amazon Bedrock, and any other connected providers — not Free / Paid.
2. Click `opencode/mimo-v2.5-free` (or `mimo-v2.5-free`) → Save → run a test case → 200 from Zen with a screenshot attached.
3. Clear `defaultModel` on the provider → agent uses `mimo-v2.5-free`.
4. Select `litellm/claude-haiku-4-5` (with LiteLLM configured in OpenCode) → vision hits the LiteLLM `baseURL`, not Zen. Helper text talks about the LiteLLM gateway.
5. Select an Amazon Bedrock model → vision error says Yoqa uses OpenCode Zen or LiteLLM.
6. Select `deepseek-v4-flash-free` → clear error that the model is text-only; switch to `mimo-v2.5-free`.

## Known upstream quirk

Most Zen free models are **text-only** and reject `image_url` (HTTP 400 `unknown variant image_url` or “No endpoints found that support image input”). Reproduced for `deepseek-v4-flash-free`, `big-pickle`, `laguna-s-2.1-free`, `north-mini-code-free`, `nemotron-3-ultra-free`, `ling-3.0-tiny-free`. `mimo-v2.5-free` accepts vision. `longcat-2.0-free` accepts the request but often ignores the image.

Paid multimodal models (Gemini / Claude / GPT on Zen) need billing and may use different Zen endpoints (`/messages`, `/responses`, Gemini generateContent) — Yoqa currently talks OpenAI chat-completions style against `/zen/v1`.

## Follow-ups

- Route Amazon Bedrock / Copilot / other native OpenCode providers through their own auth instead of Zen for vision.
- If Zen adds pricing / modality fields to `/models`, surface that as secondary metadata (not as the primary grouping).
- Optionally warn when an existing provider still has a non-vision `defaultModel` (proactive UI banner).
- Route Claude/Gemini/GPT Zen models through their documented endpoints if we want paid Zen vision without chat-completions quirks.
