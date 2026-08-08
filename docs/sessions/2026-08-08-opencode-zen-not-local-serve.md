# OpenCode vision: Zen, not local serve `/v1`

## Goal

Stop vision runs failing with `OpenCode request failed (200): <!doctype html>…` (OpenCode web UI HTML).

## Plan summary

- Confirmed on OpenCode `1.18.15`: `opencode serve` has no OpenAI-compatible `/v1/chat/completions`; unknown `/v1/*` routes fall through to the SPA (`text/html`, 200).
- T3 Code talks to serve via `@opencode-ai/sdk` (native session/message API), not OpenAI `/v1`.
- Rejected: keeping “spawn serve + OpenAI SDK” for CLI-only vision until a native client exists.

## What shipped

- Vision always uses Zen (`https://opencode.ai/zen/v1`) for OpenCode; requires a Zen API key.
- Clearer error when a response body is HTML; auth gate no longer treats CLI/serve alone as vision-ready.
- Docs updated to match.

## How to verify

1. Settings → OpenCode → paste Zen API key → Validate → run a vision case.
2. Without a key: toast/message asks for Zen API key (not HTML dump).
3. Optional: `curl -s http://127.0.0.1:<serve>/v1/chat/completions` → HTML; `/global/health` → JSON.

## Follow-ups

- Optional: native OpenCode session client (t3code-style) so CLI login works without Zen.
- Optional: probe Server URL for real OpenAI `/v1` proxies before using them.
