# Run detail: case, device, and AI thoughts

## Goal

Make each run readable at a glance (which test case, which device) and let you inspect what the vision agent was thinking under each step, with a click-to-expand summary.

## Plan summary

- Join catalog cases and device inventory on the client (same pattern as existing case titles on detail).
- Enrich the vision decision JSON with required `reason` (one sentence) and `thoughts` (2–4 sentences); keep storing the full decision in `action_json` — no SQLite migration.
- Do not enable provider chain-of-thought or token streaming.

Rejected: snapshotting device fields onto the `runs` row; raw model CoT logs.

## What shipped

**Runner**
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) — `reason` + `thoughts` required on every decision; system prompt updated
- Synthetic fail decisions in [`application.ts`](../../services/runner/src/domains/runs/application.ts) include both fields

**Desktop**
- [`labels.ts`](../../apps/desktop/src/mainview/features/runs/labels.ts) — shared case/device label helpers
- [`list-page.tsx`](../../apps/desktop/src/mainview/features/runs/list-page.tsx) — friendly device label; tests column shows case name(s) + pass/fail counts
- [`detail-page.tsx`](../../apps/desktop/src/mainview/features/runs/detail-page.tsx) — device name/model/OS (+ UDID helper); per-step collapsed `reason` with expandable `thoughts`

## How to verify

1. Start a run; list shows case name(s) and a friendly device label (not only UDID).
2. Open run detail; header/subtitle show device name · model · OS; each test shows `#N Name`.
3. New steps: short reason under the action; click **AI thoughts** to expand the longer summary.
4. An older run without `thoughts` still renders (`detail`/`reason` only; no expand control).
5. `cd services/runner && bun run check`

## Follow-ups

- Snapshot device metadata onto the run at create time for offline history
- Stream model tokens into the live run UI (see [ai-sdk-vision.md](./ai-sdk-vision.md))
- Provider raw chain-of-thought when a model exposes it
