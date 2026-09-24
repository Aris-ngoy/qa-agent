# Agent step latency, App Knowledge, and screenshot retention

## Goal

Agent-mode Runs on real devices were slow and hard to explain: per-step latency plateaued around 35s (a reasoning model burning the output budget, then a silent JSON-repair retry doubling the call), the agent flailed on recurring screens, and the report showed a single latency number. The device loop also re-read work it had already done, and run screenshots accumulated forever (observed: 6 GB / 8,939 files).

From spec: [#141](https://github.com/Aris-ngoy/qa-agent/issues/141).

## What shipped

**Decide latency**
- The Case executor prepares the vision image once per screenshot (1170px JPEG q70) and reuses it for every retry in that step; adapters fall back to preparing the raw PNG when no prepared image is supplied.
- Groq decide/ground calls on reasoning families (qwen3) run with `reasoning_effort: "none"` via the driver request hook; Groq's output budget drops to 2048 tokens so a runaway trace fails fast. OpenCode already disabled thinking.
- One Screen read per step: the cleaned tree read for decide is passed to Action application, so id/label taps no longer trigger a second device `pageSource`.
- Step reports carry a per-phase breakdown — `capture · screen · image · decide · action · settle` plus the decide retry count (JSON repair or unusable first reply) — stored on the step and rendered in markdown/HTML reports. The headline latency number is unchanged and still equals capture+screen+image+decide.

**App Knowledge**
- A free-form, per-app notes document (2 KB cap), editable in desktop Settings → Configuration, via `yoqa apps update --knowledge`, or `PATCH /apps/:id`. Injected into every agent decide prompt under an "App knowledge" header; absent → prompt is byte-identical to before. Good for facts like "cold start shows a verification splash — tap Continue" or tab-bar order.

**Provider guardrails**
- Provider model lists can carry a tri-state vision flag (`true` / `false` / unknown). Groq tags known vision (`llama-4-scout|maverick`) and known text-only families (qwen, deepseek, llama-3, gemma, mixtral, gpt-oss, whisper). Settings shows a non-blocking warning when the chosen default model is known to be blind; unknown models never false-warn.

**Screenshot retention**
- Step screenshots older than `YOQA_SCREENSHOT_RETENTION_DAYS` (default 7, `0` disables) are pruned at run start, best-effort in the background. Age-based pruning never touches screenshots of runs in progress (they are always fresh).

## How to verify

Before/after on the same case and device:

1. Run the same case with your current default model; export the report and note the per-step `decide` phase and `retries` count.
2. Switch Settings → Provider → Default model to a vision model for your provider (on Groq: `meta-llama/llama-4-scout-17b-16e-instruct`). The Settings card now flags known text-only models.
3. Re-run the same case. Expect: `decide` phase roughly halved-to-flat (no thinking, no repair retries → `retries` absent), identical `capture`/`screen`/`image` phases, and the run completing in fewer steps when App Knowledge covers recurring screens.
4. Add App Knowledge for the app (e.g. splash + nav order) and re-run to see first-step handling improve.

CLI equivalents: `yoqa apps update <app> --knowledge "..."` and `yoqa apps get <app>`.

## Notes

- Deeper image compression and JSON/instruction compression were evaluated and rejected with evidence (see issue #141): images are already resized before send, and the text payload is ~2–3K tokens.
- The per-phase breakdown is also the instrument for future latency work: if `decide` dominates, it's the model; if `screen` dominates, it's the device read.
