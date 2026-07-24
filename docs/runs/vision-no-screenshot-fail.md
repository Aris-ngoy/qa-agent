# Vision agent “no screenshot” fail

## Goal

Stop runs from failing with agent reasons like “No screenshot provided…” when Appium did capture a PNG and the model was sent `image_url` / Anthropic image content.

## Plan summary

- Root cause is model hallucination / weak vision behavior (seen with OpenCode `deepseek-v4-flash-free`), not a missing capture path.
- Harden the system prompt, pass recent action history, retry absurd “no screenshot” fails once, add `wait` for splash screens, and settle briefly after tap/type.

Rejected: treating every `fail` as retryable; switching providers automatically mid-run.

## What shipped

- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts): stronger vision rules; `wait` action; `recentActions` in the prompt; `isAbsurdNoScreenshotFail()`.
- [`application.ts`](../../services/runner/src/domains/runs/application.ts): pass history; one retry on absurd fail then clearer error; 800ms settle after tap/type; execute `wait` (500–3000ms).

## How to verify

1. Run a case that opens with a splash, then needs bottom-tab navigation (e.g. Discover → Rewards).
2. Early steps should `wait` on splash (or settle after load), not tap a missing Rewards tab.
3. Once Rewards is visible, agent should `verify`/`done`, not `fail` with “no screenshot”.
4. If the model still claims no screenshot twice, step detail mentions ignoring the attached screenshot / try a stronger vision model.

## Follow-ups

- Stronger default / UI warning for flaky free vision models.
- Optional page-source grounding when vision is unsure.

## Related: “Model did not return JSON”

On multi-flow cases (e.g. Rewards nav then coupons payout), free vision models often reply with prose instead of an action object. Hardened in the same agent path: stricter JSON-only prompt, tolerant extract/repair, OpenAI-compatible `response_format: json_object` when supported, one repair retry, and keep the step screenshot when parse still fails.
