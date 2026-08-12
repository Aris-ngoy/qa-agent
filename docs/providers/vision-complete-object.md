# Provider vision completion on the adapter

## Goal

Finish ADR-0002: vision decide/ground call `completeObject` on the Provider adapter. Callers and tests stop switching on kind.

## Plan summary

- Optional `vision?: { completeObject }` on `DriverDefinition`. Invariant: `capabilities.vision === Boolean(driver.vision)`.
- Runs still owns the agent prompt and decision schema; Grounding still owns the `{x,y}` schema and tree summary.
- Adapters hide keys, CLI spawn, AI SDK model construction, image resize, and one JSON-repair retry.
- Shared SDK helper for Anthropic/OpenAI/Groq/Grok/Google/Vertex/Codex/OpenCode/Custom. Cursor and Antigravity implement `completeObject` via CLI print (Antigravity falls back to Google AI Studio when a key is present).
- Rejected: separate `decide`/`ground` methods on the adapter; a `VisionProviderKind` allowlist beside drivers.

## What shipped

- `DriverDefinition.vision.completeObject` on every vision-capable adapter
- `completeVision` / `resolveVision` dispatch with no kind switch
- `decideNextAction` and `groundDescription` call that one interface
- Deleted `cursor-decide.ts` and `antigravity-decide.ts`
- Tests: catalog invariant + resolveVision for vision vs non-vision kinds

## How to verify

```bash
bun run test
bun run check
bun run lint:ci
```

Optional: agent run with OpenAI/Anthropic; Cursor CLI decide; Antigravity CLI Grounding (`action tap -d "…"`).

## Follow-ups

- Desktop `FALLBACK_ACTIVE_DRIVERS` still duplicates catalog facts (ADR-0002 leftover)
- Per-driver `vision.completeObject` tests against recorded CLI/SDK fixtures
