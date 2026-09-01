# Agent runs one instruction at a time

## Goal

Stop the vision agent from hallucinating on long catalog cases (e.g. **#8 Payout** with 20 flow steps). When every instruction is in the same prompt, the model skips ahead, invents later taps, or wanders to unrelated tabs.

## Plan summary

- Flatten catalog flows into a queue of atomic instructions (numbered / bulleted lists split; a single paragraph stays one step).
- Each vision call gets **only the current instruction**, completed ones as a short list, and a remaining count. Later instruction text is hidden.
- `verify` / `done` finishes the current instruction and advances the queue — it does not pass the whole case.
- Rejected: concatenating all flow text into one prompt; treating `verify` as “the test is over”.

## What shipped

- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts): `splitInstructionSteps`, `flattenCaseInstructions`, `formatDecidePrompt`; system prompt says complete only the current instruction and stay on this screen.
- [`case-executor.ts`](../../services/runner/src/domains/runs/case-executor.ts): loop the instruction queue; keep recent actions and completed instructions across the case; max steps apply per instruction.
- A flow’s `expectedResult` is attached only to its **last** numbered line.

## How to verify

1. Restart the desktop / runner sidecar so it picks up runner TypeScript.
2. Run **#8 Payout** (or any case with many flows) with **Use AI agent**.
3. Early steps should only mention the current instruction (e.g. “Navigate to Rewards”), not Hello Fresh / later confirms.
4. After a verify, the next step’s reason should match the **next** catalog flow, not skip to the end.
5. A numbered list inside one flow (`1. … 2. … 3. …`) should produce a verify between items, not one pass for the whole list.

## Follow-ups

- Optional: fail fast when the current target is not on this screen after a few scrolls, instead of wandering.
