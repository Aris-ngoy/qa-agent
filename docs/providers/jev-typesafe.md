# Jev TypeSafe judge

## Goal

Add Jev (TypeSafe System One) as a Settings provider and use it as an optional structured judge for agent `verify` / `done` / `fail`. Vision providers still drive taps and grounding from screenshots.

## Plan summary

- Jev is text-only and returns typed Noul/Choice/Score answers — it cannot implement `vision.completeObject`.
- Follow ADR-0002: callers do not switch on `kind`. Drivers declare `capabilities.judge` plus an optional `judge.confirmInstruction` port.
- When an enabled Jev provider exists, the agent loop confirms vision verify/done/fail against the accessibility tree. Judge errors fail open (keep the vision decision).
- Non-vision providers cannot steal the Settings default used for agent runs. Runs resolve a vision-capable provider even if Jev is the flagged default.
- Rejected: using Jev as the tap/grounding model; mapping the full agent decision schema to Choice questions.

## What shipped

- `jev` in `providerKindSchema`; catalog `capabilities.judge`.
- Runner driver [`services/runner/src/domains/providers/drivers/jev.ts`](../../services/runner/src/domains/providers/drivers/jev.ts) via [`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript) (`TYPESAFE_API_KEY`, optional base URL for [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)).
- Noul composition and thresholds in [`jev-judge.ts`](../../services/runner/src/domains/providers/jev-judge.ts).
- `resolveVisionProviderAuth` / `resolveJudgeProviderAuth`; `yoqa status` reports `judge` when configured.
- Agent loop: [`case-executor.ts`](../../services/runner/src/domains/runs/case-executor.ts) rewrites premature verify to `wait` when Jev continues.
- Settings: Jev catalog card, no Set as default, optional Gateway base URL.

## How to verify

1. Settings → Providers → Add **Jev** → paste `TYPESAFE_API_KEY` → Validate. Models should include `jev-latest` (and `jev-1.13.0`).
2. Keep Anthropic/OpenAI/etc. as the default vision provider. Jev should not become default.
3. `yoqa status` shows `provider: …` (vision) and `judge: Jev` when Jev is enabled.
4. Run an agent case. A premature `verify` should not finish the instruction when Jev disagrees (step becomes a short wait with Jev’s reason).
5. `bun run test && bun run check && bun run lint:ci`

## Follow-ups

- Tree-only Jev agent (tap by id/label, no screenshot coordinates)
- Screenshot → text preprocessing if TypeSafe adds multimodal state
- Using Jev for `assert` rubrics
