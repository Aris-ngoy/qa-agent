# Test case selection + runs MVP

## Goal

Selected test cases (list multi-select or the open detail page) enable the global Run button, and clicking Run starts a local `POST /runs` with Appium + a minimal vision agent loop.

## Plan summary

- Shared `TestCaseSelectionProvider` feeds the Runs panel.
- List checkboxes for multi-select; opening a detail page sets selection to that case.
- Runner persists `runs` / `run_tests` / `run_steps` in SQLite and executes asynchronously.
- Vision via Anthropic / OpenAI / OpenCode using `resolveActiveProviderAuth()` (inference now through AI SDK — see [ai-sdk-vision.md](./ai-sdk-vision.md); Settings kinds also include Groq / Google / Vertex / Antigravity / Codex — see [ai-sdk-settings-providers.md](../providers/ai-sdk-settings-providers.md)).
- Mock builds kept as labels only (no install yet).

Rejected for this slice: full action surface, CLI `runs`, CLI-only provider vision (Claude/Codex CLIs).

## What shipped

**Desktop**
- [`selection-context.tsx`](../../apps/desktop/src/mainview/features/test-cases/selection-context.tsx) — selected case IDs; clears on app change
- List checkboxes + select-all; detail auto-selects `caseId`
- Runs panel: `canRun` requires app + device + build + selection; `createRun` mutation with error UI

**Client**
- `createRun` / `getRun` + run schemas in `@yoqa/runner-client`

**Runner**
- SQLite tables for runs / run_tests / run_steps
- `POST /runs`, `GET /runs/:runId`
- Appium process ensure + WebDriverIO session (screenshot, tap, type)
- Vision decide → execute loop; updates `cases.last_run_at` / `last_run_status`
- OpenCode vision via AI SDK OpenAI-compatible chat (`createOpenAI(...).chat`) when an API key is present
  (Settings key, env, or CLI `~/.local/share/opencode/auth.json` from `opencode providers login`)
  — see [ai-sdk-vision.md](./ai-sdk-vision.md)

## How to verify

1. Configure an Anthropic, OpenAI, or OpenCode provider (API key) and set it as default/enabled.
2. Select an app → create/open cases with flow instructions.
3. List: check 1–2 cases → pick device + build → Run enabled → click Run.
4. Detail: open one case → Run enabled without list checkboxes.
5. `GET /runs/:id` moves queued → running → passed/errored; list Last Run updates.
6. No selection / no provider / device not ready → Run disabled or clear error.

## Follow-ups

- Real build install/register
- Vision for CLI-only providers (Claude, Codex, …)
- Richer actions, screen tree, grounding memory
- See also [run-ui-and-cancel.md](./run-ui-and-cancel.md) for live run page, cancel, and runs history list
- See also [wda-rebuild-skip.md](./wda-rebuild-skip.md) — mock builds replaced by Skip/Rebuild WDA
