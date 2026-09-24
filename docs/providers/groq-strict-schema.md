# Groq strict JSON schema compat

## Goal

Fix the Groq `400 invalid JSON schema for response_format` failure on vision decide, where Groq's strict `json_schema` mode requires `required` to list every property while the agent decision schema keeps 18 Action fields optional.

## Plan summary

- Key decision: Groq-only request-level fix — send loose `json_object` via `providerOptions: { groq: { structuredOutputs: false } }`, keeping the shared decision schema untouched and client-side Zod plus salvage/repair as validation.
- Rejected alternatives: rewriting the decision schema to strict-compatible form (all keys required/nullable forces the model to emit every field); a fetch-hook strip of `response_format` (works but bypasses the provider's supported option).
- Blast radius: Groq driver path only; Anthropic/OpenAI/Google and other Vision-capable Providers unchanged.

## What shipped

- `services/runner/src/domains/providers/vision-model.ts`: `providerOptionsForVision()` returns non-strict JSON options for the Groq label only; `completeWithAiSdk()` forwards it to `generateObject`; `formatProviderHttpError()` maps Groq strict-schema 400s to an actionable retry message.
- Ownership per ADR-0002 holds: the agent decision schema stays in Runs; Providers only perform vision completion.
- `services/runner/src/domains/providers/vision-model.groq.test.ts`: locks the Groq-only provider options, default behavior for others, and the mapped 400 message.

## How to verify

- `bun test services/runner/src/domains/providers/vision-model.groq.test.ts`
- `bun test services/runner/src/domains/providers/`
- `bun run check`
- Live (with `GROQ_API_KEY`): run an agent decide on the default scout model and confirm a valid Action returns instead of the 400.

## Follow-ups

- None known. If Groq adds strict-mode support for sparse `required`, revisit whether to re-enable structured outputs for tighter guarantees.
