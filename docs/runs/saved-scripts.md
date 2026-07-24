# Saved scripts + script vs AI run mode

## Goal

After a successful AI agent run, persist a replayable script on the test case so later runs can skip the model. When a selected case already has a script, prompt the user to choose saved script (default) or AI agent.

## Plan summary

- Store a versioned `CaseScript` (tap / type / wait actions) on each case.
- Auto-save after a **passed agent** run (overwrite previous script).
- `createRun.executionMode`: `auto` | `script` | `agent`.
- Per case: script mode if a script exists (unless forced to agent); otherwise agent.
- Vision provider required only when at least one case needs the agent.
- Desktop prompts only when ≥1 selected case has a script.

Rejected for this slice: manual “Save script” UI, editing scripts, invalidating scripts when flows change, fallback-to-agent on mid-replay failure.

## What shipped

**Client (`@yoqa/runner-client`)**
- `caseScriptSchema` / `CaseScript`
- `CatalogCase.hasScript` + `scriptSavedAt`
- `CreateRunRequest.executionMode`
- `Run.executionMode` + optional `RunTest.executionMode`

**Runner**
- SQLite: `cases.script_json`, `cases.script_saved_at`; `runs.execution_mode`; `run_tests.execution_mode`
- Replay path without LLM; agent path unchanged except save-on-pass
- Provider assert skipped for all-script runs

**Desktop**
- Run button: no script → agent; any script → dialog (Use saved scripts / Use AI agent / Cancel)
- Case detail **Script** tab lists saved actions (or empty state when none)

## How to verify

1. Run a case with the AI agent until it **passes**.
2. Confirm the case now has `hasScript: true` (re-open list / detail or check after the run finishes).
3. Select that case + device → Run → dialog appears; **Use saved scripts** starts a run without calling the vision provider.
4. Same selection → **Use AI agent** runs the vision loop and refreshes the script on pass.
5. Select a case with no script → Run starts the agent with no dialog.

## Follow-ups

- Show a “Script” badge on the case list
- Clear / re-record script when flows change
- On script replay failure, optional one-click “retry with AI”
- CLI flag for `--mode script|agent`
- ~~View saved script on case detail~~ — Script tab on detail page
