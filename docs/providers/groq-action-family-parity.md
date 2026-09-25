# Groq Action-family parity

## Goal

Close #140 (part of #137): every Action family decided through the Groq Vision-capable Provider behaves exactly like on any other Vision-capable Provider, so a full Test Case — taps, swipes, drags, typing, alerts, app lifecycle, navigation, asserts, waits, verify/done/fail — completes on Groq with explainable `reason` and `thoughts`.

The provider-side compensation already shipped in #138 (decide asks for JSON in the prompt only, because Groq rejects strict `json_schema` for the sparse decision shape). What was missing was proof at the seam: the parity rules lived in unit tests that called `parseAgentDecision` with a hard-coded `"Groq"` label, which proves the schema and nothing about the Groq transport.

## Plan summary

- The seam under test is the one the Case executor actually uses: `decideNextAction` → `completeVision` → `groqDriver.vision.completeObject`. Only `globalThis.fetch` is faked, so the real prompt, the real decision schema, the real Groq request hook, and the real salvage/repair path all run. The Case executor loop is never entered.
- Parity is asserted as external behavior: canned Groq chat-completion reply in, validated domain decision (or a not-a-valid-action error) out. No internals are asserted beyond the bytes on the wire.
- The "unchanged" criteria (Grounding, Provider auth, model listing, default model selection, screenshot preparation, token budget) are asserted on the same seam so a future change to the Groq adapter cannot quietly move them.
- Rejected: a Groq-specific schema variant, a second retry, touching the Case executor or the decision-to-Action mapping, and per-family mocks of `generateObject` (they would prove the AI SDK, not the Groq path).
- Parity with other Providers is structural, not duplicated per provider: all vision adapters share `completeWithAiSdk` and the same Runs-owned schema, and `vision.test.ts` already pins the `capabilities.vision === Boolean(driver.vision)` invariant across the catalog.

## What shipped

- [`agent.groq.test.ts`](../../services/runner/src/domains/runs/agent.groq.test.ts) — Action-family parity at the vision seam: 24 valid families (tap by coordinates / id / label / description, double-tap, long press, swipe by direction and by coordinates, drag, type, input, wait, alert accept and dismiss, activate / terminate / restart / background app, open-url, assert visible and not-visible, verify, done, fail), each also asserting `reason` and `thoughts` survive and that the outgoing request carries no structured-output marker.
- Same file — cross-field rejections through the seam: swipe without direction or four coordinates, partial swipe coordinates, drag without a drop point, type/input without text, open-url without a URL, assert without text, missing or blank `reason`/`thoughts`, and an unknown type. Each asserts the not-a-valid-action message, exactly one JSON-only repair retry, and that the repair request re-asks for strict JSON.
- Same file — repair flow: fenced single-quoted JSON and a lightly truncated reply still validate; a prose-only reply fails with what the model returned.
- Same file — unchanged surfaces: default vision model fallback and configured override, `max_tokens: 2048` decide budget, bearer auth header, custom base URL, missing-key fast failure, and the prepared screenshot (PNG and JPEG) plus the JSON-only instruction travelling unchanged.
- [`vision-model.groq.test.ts`](../../services/runner/src/domains/providers/vision-model.groq.test.ts) — model listing and Provider auth against a stubbed Groq catalog: vision flags, "N models available", bearer token on `/models`, and both no-key paths proving the gateway is not called.
- [`grounding.test.ts`](../../services/runner/src/domains/devices/grounding.test.ts) + `groundResultSchema` export — Grounding through the same port keeps `response_format` (`required: [x, y]`) and still resolves coordinates, proving the hook only strips sparse decide schemas.

## How to verify

```bash
cd services/runner && bun test src/domains/runs/agent.groq.test.ts src/domains/providers/vision-model.groq.test.ts src/domains/devices/grounding.test.ts
cd /Users/arisngoy/PROJECTS/qa-agent && bun run check && bun run lint:ci
```

Optional: run an agent-mode Test Case on Groq and check the Run timeline shows a `reason` for every step.

## Follow-ups

- Extend the same seam suite to the remaining SDK adapters (Anthropic, OpenAI, Grok, Google, Vertex, Codex, OpenCode, Custom); this issue covered Groq only. The first item in [`vision-complete-object.md`](./vision-complete-object.md) follow-ups is now partly closed.
- `listOpenCodeModelsFromCli` is environment-dependent (it shells out to the installed `opencode` CLI and asserts a live model id) and fails on some machines in the full suite — pre-existing, unrelated to Groq.
