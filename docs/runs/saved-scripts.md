# Saved scripts + script vs AI run mode

## Goal

After a successful AI agent run, persist a replayable script on the test case so later runs can skip the model. When a selected case already has a script, prompt the user to choose saved script (default) or AI agent. Let users inspect, edit, delete, and export scripts for the YoQA CLI.

## Plan summary

- Store a versioned `CaseScript` (tap / type / wait actions) on each case.
- Auto-save after a **passed agent** run (overwrite previous script).
- `createRun.executionMode`: `auto` | `script` | `agent`.
- Per case: script mode if a script exists (unless forced to agent); otherwise agent.
- Vision provider required only when at least one case needs the agent.
- Desktop prompts only when ≥1 selected case has a script.
- Detail Script tab: steps / JSON / CLI shell, edit JSON, delete, export files.
- CLI: `yoqa script run <file.yoqa.json>` against the active device.

Rejected for this slice: structured per-step visual editor, invalidating scripts when flows change, fallback-to-agent on mid-replay failure.

## What shipped

**Client (`@yoqa/runner-client`)**
- `caseScriptSchema` / `CaseScript`
- `CatalogCase.hasScript`, `scriptSavedAt`, `script`
- `UpdateCaseRequest.script` (`null` clears)
- `formatCaseScriptJson` / `formatCaseScriptShell` / `suggestedScriptBasename`
- `CreateRunRequest.executionMode`
- `Run.executionMode` + optional `RunTest.executionMode`

**Runner**
- SQLite: `cases.script_json`, `cases.script_saved_at`; `runs.execution_mode`; `run_tests.execution_mode`
- Replay path without LLM; agent path unchanged except save-on-pass
- Provider assert skipped for all-script runs
- `yoqa script run <file>` + `yoqa runs create … --mode`

**Desktop**
- Run button: no script → agent; any script → dialog (Use saved scripts / Use AI agent / Cancel)
- Case detail **Script** tab: Steps / JSON / CLI shell, Edit, Delete, Export JSON / Export shell

## How to verify

1. Run a case with the AI agent until it **passes**.
2. Open the case → **Script** tab → see steps; switch to **JSON** / **CLI shell**.
3. **Edit** the JSON, save; **Export JSON** and run `yoqa script run <file>` with a connected device.
4. **Delete** the script → empty state; Run uses the AI agent again.
5. Select a case with a script → Run → dialog; **Use saved scripts** skips vision.

## Follow-ups

- Show a “Script” badge on the case list
- Clear / re-record script when flows change
- On script replay failure, optional one-click “retry with AI”
- Structured step editor (not only JSON)
