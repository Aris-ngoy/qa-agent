# Salvage truncated / slightly-invalid vision JSON

## Goal

Keep agent runs (and CLI `-d` grounding) going when the vision model returns a near-miss action object instead of failing the run with “Model did not return JSON”.

## Plan summary

The logged failure was a tap to dismiss onboarding (`y: 1006`, `thoughts` often cut off). That is valid intent: Zod `.max(1000)` and fence-only JSON repair treated it as a hard error.

- Salvage locally: close truncated strings/braces, coerce loose JSON, clamp coords to 0–1000, copy `reason`↔`thoughts` if one is missing.
- Loosen `agentDecisionSchema` / `groundResultSchema` so `generateObject` does not reject overshoot coords; clamp after parse (gestures already clamp in `session.tap`).
- If JSON parses but still fails the action shape, say “JSON was not a valid action”, not “did not return JSON”.
- CLI `yoqa` does not parse model JSON; `yoqa runs create` and `yoqa action tap -d` share this runner path. Skill docs unchanged.

Rejected: a JSON-repair npm dependency; a second model retry for out-of-range coords; rewriting yoqa-testing skill markdown.

## What shipped

- [`json-salvage.ts`](../../services/runner/src/domains/providers/json-salvage.ts) — `salvageAgentJsonText`, `closeTruncatedJson`, `normalizeVisionJson`
- [`agent-json.ts`](../../services/runner/src/domains/providers/agent-json.ts) / [`vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts) — extract, `generateObject` repair, and fallback use salvage + clamp
- Cursor / Antigravity CLI adapters parse through `parseVisionObject`
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) / [`grounding.ts`](../../services/runner/src/domains/devices/grounding.ts) — x/y (and wait `ms`) accepted as numbers, then clamped

## How to verify

```bash
cd services/runner && bun test src/domains/providers/agent-json.test.ts src/domains/runs/agent.test.ts src/domains/devices/grounding.test.ts
bun run check
```

1. Re-run the onboarding case (desktop Runs or `yoqa runs create … --wait`): first step should tap the bottom CTA, not stop with “Model did not return JSON”.
2. Optional: `yoqa action tap -d "bottom Continue / Get Started"` should resolve coords when the model overshoots `y`.

## Follow-ups

- None required. CaseScript replay files still validate `x`/`y` in 0–1000; new scripts are clamped before save.
