# Step latency attribution (#129)

## Goal

Make agent-Step slowness triagable: split the single `latencyMs` number into perceive-plus-decide vs gesture-plus-settle, per parent spec #128 (reference run `run_ce1843a2`: 4m29s, ~35s/Step, user-cancelled).

## Plan summary

- Key decision: preserve `latencyMs` as perceive-plus-decide (screenshot + Screen read + vision decide) and add `actionMs` for gesture-plus-settle, additive and backward compatible. Rejected: redefining `latencyMs` as wall time (breaks existing reports) and a second repair/judge split (deferred to #134).
- Key decision: measure at the Case executor seam (injected session/decide/clock), not in prompts or providers. Rejected: per-driver timing hacks.
- Key decision: nullable `action_ms` storage so pre-attribution rows render the old single number with no action line. Rejected: `NOT NULL DEFAULT 0` backfill (renders misleading `Action: 0ms` on historic runs).

## What shipped

- Case executor records `actionMs` (perform + settle) alongside `latencyMs` for agent and script Cases; terminal fail rows carry `0`.
- Storage: nullable `action_ms` column with create-table plus additive migration; orchestration persists and loads it.
- API schemas: optional nullable `actionMs` on `RunStep`; no other shape changes.
- Reports: Markdown adds `- Action: Nms`; HTML shows `Nms + action Mms` (action-only fallback included).
- Glossary (`CONTEXT.md`): `Latency` is perceive-plus-decide; `Step` vs `Action` vs `command` reaffirmed.
- Tests: slow-decide and slow-settle attribution at the Case executor seam with fake session and scripted decide.

## How to verify

- `bun test services/runner/src/domains/runs/case-executor.test.ts packages/runner-client/src/run-report.test.ts packages/runner-client/src/schemas.test.ts`
- `bun run test`, `bun run check`, `bun run lint:ci`
- One real-device agent Run: Step rows carry both timings and the report shows both lines.

## Follow-ups

- #132 (capture-once + single-wait settle), #130 (loop fail-fast), #134 (single-turn decide counts), #133 (grounding cache + script promotion), #131 (report slimming) all build on this attribution.
- Local dev DBs created by the earlier `NOT NULL` revision of this branch keep that column shape; fresh checkout or DB reset picks up the nullable form.
