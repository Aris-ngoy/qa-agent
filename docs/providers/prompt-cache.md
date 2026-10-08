# Prompt cache for Decide/verify + per-step Call usage

Spec: [#208](https://github.com/Aris-ngoy/qa-agent/issues/208). Slices: [#209](https://github.com/Aris-ngoy/qa-agent/issues/209) (request order, cache breakpoints, Call usage reporting) and [#210](https://github.com/Aris-ngoy/qa-agent/issues/210) (per-step totals, persistence, display). Terms (**Prompt cache**, **Call usage**) are defined in [`CONTEXT.md`](../../CONTEXT.md).

## Goal

Every Decide and verify call sent its whole request from scratch, with the screenshot before the prompt text. The only stable prefix a Provider could cache was the system prompt, and Anthropic never got the explicit cache breakpoints it needs. Nobody could see what a step cost or how much came from the Prompt cache.

We set out to:

- order each request so the parts that stay the same for a Test Case form a true prefix;
- mark that prefix for Anthropic;
- record Call usage (fresh input, Prompt cache reads, Prompt cache writes, output) per step, next to the existing phase breakdown.

## Plan summary

- **Two-part prompt.** The vision input takes a `VisionPrompt` of `{ testCase, step }` instead of one string. The Test Case block holds app context, App Knowledge, case title and catalog app id. The step block holds progress, completed instructions, current instruction, expected result, recent actions, last error, screen tree, grid notes and the final "do ONLY this" reminder. Message order: Test Case block, screenshot, step block. `testCase` is optional: a call outside a Test Case (grounding) omits it and sends no Test Case block. The wording is unchanged; only the order moved.
- **Cache markers in one place.** The shared AI SDK path (`completeWithAiSdk` in `services/runner/src/domains/providers/vision-model.ts`) adds Anthropic ephemeral `cacheControl` on the system message and the Test Case block. Other SDK Providers (OpenAI, Codex, Google, Vertex, Groq, Grok, OpenCode, Custom) get no markers and rely on automatic prefix caching. The JSON-repair retry appends to the step block, so the prefix stays the same.
- **Call usage callback.** `VisionCompleteInput.onUsage` mirrors `onDecideRetry`. The SDK path converts AI SDK usage and provider metadata into a `CallUsage` and fires it once per call, so each retry reports its own Call usage. Non-SDK paths (Claude CLI, Cursor, Antigravity, Copilot) never fire it, so their steps show no usage rather than zero.
- **Per-step totals at the Case executor.** The injected decide and verify functions take the same optional `onUsage`. The executor adds every report for a step (each decide attempt, the no-screenshot retry, grid-cell and screenshot-point retries, the action-error re-decide, and verify) into `phases.usage`. A field is null when no call reported it.
- **No migration.** `usage` lives inside the existing `run_steps.phasesJson` as an optional field.
- Rejected: changing the `VisionPort` return type to carry usage (callbacks keep every adapter untouched); a decision cache or multi-turn history (out of scope in #208); converting tokens to money.

## What shipped

- **#209:** `VisionPrompt`, `CallUsage` and `onUsage` in `providers/drivers/types.ts`; Test Case block / step block split in `runs/agent.ts`; request assembly, Anthropic breakpoints and `toCallUsage` in `providers/vision-model.ts`; `decideNextAction` and `verifyInstruction` pass `onUsage` through.
- **#210:**
  - `callUsageSchema` / `CallUsage` in `packages/runner-client/src/schemas.ts` are now the single source of the shape (the driver type re-exports it). `stepPhasesSchema` gains optional `usage`; steps saved before this change still parse.
  - `CaseDecideFn` input gains `onUsage`. `executeAgentCase` wires it into every decide and verify call (injected fakes and production) and sums the results into the step's phases. `usage` is left out when nothing reported.
  - `formatStepPhases` appends the step's Call usage and cached share, e.g. `usage in 250, cached 1800, cache write 900, out 60 (61% cached)`. The share is cache reads over all input (fresh + reads + writes). This is the phase breakdown shown in the HTML/Markdown run reports exported from the desktop run detail and Inspector, and in `yoqa report`. Steps without `usage` show nothing extra.

## How to verify

- `bun run lint:ci && bun run test && bun run check` from the repo root.
- Request shape and usage conversion: `services/runner/src/domains/providers/vision-model.prompt-cache.test.ts`.
- Per-step totals: `services/runner/src/domains/runs/case-executor.test.ts` ("adds up Call usage across decide retries and verify…", "leaves Call usage out…").
- Parsing and display: `packages/runner-client/src/schemas.test.ts`, `packages/runner-client/src/run-report.test.ts`.
- Manual: run an agent Test Case on Anthropic, export the report from the run detail, and check later steps show a growing cached share. Spot-check a few Runs on a vision Provider, since moving the screenshot after the Test Case text can slightly change model behaviour.

## Follow-ups

- A dedicated in-app phase/usage view on the desktop run timeline (today the breakdown appears only in exported reports).
- Run-level or Test Case-level Call usage totals for comparing models.
