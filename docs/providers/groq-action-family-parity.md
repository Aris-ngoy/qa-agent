# Groq Action-family parity

## Goal

Close #137: make Groq agent-mode decide calls compatible with Groq's strict-schema rejection while preserving the same Action families, explanation contract, Grounding behavior, and Provider surfaces as the other Vision-capable Providers. Close #140's remaining seam coverage so a full Test Case — taps, swipes, drags, typing, alerts, app lifecycle, navigation, asserts, waits, verify/done/fail — completes on Groq with explainable `reason` and `thoughts`.

The provider-side compensation shipped in #138 asks for JSON in the prompt only, because Groq rejects strict `json_schema` for the sparse decision shape. #139 maps any strict-schema 400 to concise recovery guidance. The transport rewrite is deliberately narrow: a request-body parse or rewrite failure falls back to the original request, but a transport failure is surfaced once and never mistaken for malformed data or sent again. The remaining parity work lives at the real vision seam: the previous rules only called `parseAgentDecision` with a hard-coded `"Groq"` label, which proved the schema and nothing about the Groq transport.

## Plan summary

- The seam under test is the one the Case executor actually uses: `decideNextAction` → `completeVision` → `groqDriver.vision.completeObject`. Only `globalThis.fetch` is faked, so the real prompt, the real decision schema, the real Groq request hook, and the real salvage/repair path all run. The Case executor loop is never entered.
- Groq request rewriting is isolated from the underlying transport call. JSON parsing/rewriting falls back to the original body; an HTTP or network failure is propagated on the same request rather than triggering a second call.
- Parity is asserted as external behavior: canned Groq chat-completion reply in, validated domain decision (or a not-a-valid-action error) out. No internals are asserted beyond the bytes on the wire.
- The "unchanged" criteria (Grounding, Provider auth, model listing, default model selection, screenshot preparation, token budget) are asserted on the same seam so a future change to the Groq adapter cannot quietly move them.
- Rejected: a Groq-specific schema variant, a second retry, touching the Case executor or the decision-to-Action mapping, and per-family mocks of `generateObject` (they would prove the AI SDK, not the Groq path).
- Parity with other Providers is structural, not duplicated per provider: all vision adapters share `completeWithAiSdk` and the same Runs-owned schema, and `vision.test.ts` already pins the `capabilities.vision === Boolean(driver.vision)` invariant across the catalog.

## What shipped

- [`agent.groq.test.ts`](../../services/runner/src/domains/runs/agent.groq.test.ts) — Action-family parity at the vision seam: 27 valid families (tap by coordinates / id / label / description, double-tap, long press, swipe by direction and by coordinates, drag, type, input, wait, alert accept and dismiss, activate / terminate / restart / background app, open-url, assert visible, not-visible and text-only, verify, done, fail), each also asserting `reason` and `thoughts` survive and that the outgoing request carries no structured-output marker.
- Same file — cross-field rejections through the seam: swipe without direction or four coordinates, partial swipe coordinates, drag without a drop point, type/input without text, open-url without a URL, assert without text, an alert action outside accept/dismiss, an assertion outside visible/not-visible, missing or blank `reason`/`thoughts`, and an unknown type. Each asserts the not-a-valid-action message, that the message is labelled `Groq`, exactly one JSON-only repair retry, and that the repair request re-asks for strict JSON.
- Same file — repair flow: fenced single-quoted JSON and a lightly truncated reply still validate; a prose-only reply fails with what the model returned; a reply carrying only one explainer field is filled from the other, so a decision never reaches the Run with a blank reason or thoughts (documented salvage, see [runs/vision-json-salvage.md](../runs/vision-json-salvage.md)).
- Same file — unchanged surfaces: default vision model fallback and configured override, `max_tokens: 2048` decide budget, bearer auth header, custom base URL, missing-key fast failure, the catalog app id offered when a lifecycle decision omits one, the reason/thoughts contract still sent in the system message, and screenshot preparation both from a pre-prepared screenshot (PNG and JPEG) and from a raw PNG the adapter prepares itself.
- [`vision-model.groq.test.ts`](../../services/runner/src/domains/providers/vision-model.groq.test.ts) — model listing and Provider auth against a stubbed Groq catalog: vision flags, "N models available", bearer token on `/models`, and both no-key paths proving the gateway is not called. The request-hook suite also proves a synchronous transport failure is surfaced once, not retried as a body-rewrite fallback.
- The same decide-seam suite records a strict-schema 400 and verifies the user-facing error names Groq, explains the prompt-JSON compensation, omits the gateway field list, and does not retry the request.
- [`grounding.test.ts`](../../services/runner/src/domains/devices/grounding.test.ts) — Grounding through the same port keeps `response_format` (`required: [x, y]`) and still resolves coordinates, proving the hook only strips sparse decide schemas. That needs `groundResultSchema` exported from `grounding.ts`: the assertion is about the *real* grounding shape, and ADR-0002 keeps that schema owned by Grounding, so the export changes neither ownership nor runtime behavior.

## How to verify

```bash
cd services/runner && bun test src/domains/runs/agent.groq.test.ts src/domains/providers/vision-model.groq.test.ts src/domains/devices/grounding.test.ts
cd /Users/arisngoy/PROJECTS/qa-agent && bun run check && bun run lint:ci && bun run test
```

Optional: run an agent-mode Test Case on Groq and check the Run timeline shows a `reason` for every step.

## Follow-ups

- Extend the same seam suite to the remaining SDK adapters (Anthropic, OpenAI, Grok, Google, Vertex, Codex, OpenCode, Custom); this issue covered Groq only. The first item in [`vision-complete-object.md`](./vision-complete-object.md) follow-ups is now partly closed.
- `listOpenCodeModelsFromCli` is environment-dependent (it shells out to the installed `opencode` CLI and asserts a live model id) and fails on some machines in the full suite — pre-existing, unrelated to Groq.
