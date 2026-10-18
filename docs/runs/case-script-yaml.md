# Case Script files: YAML as the default import and export format

Spec: [Aris-ngoy/qa-agent#293](https://github.com/Aris-ngoy/qa-agent/issues/293). Decision: [ADR-0006](../adr/0006-case-script-file-yaml.md). Terms: **Case Script**, **Case Script file**, **Flow** in [`CONTEXT.md`](../../CONTEXT.md).

## Goal

Make a Case Script readable, diffable, and easy to hand-edit. A Case Script is now recorded in the Inspector, edited, exported, imported, and replayed as YAML (`*.yoqa.yaml`) rather than as Inspector shell text or `.yoqa.json`.

## Plan summary

- **One model.** A Case Script file is a YAML serialization of the existing `caseScriptSchema`. There is no new schema, no `version` bump, no database migration, and no new executor.
- **Action names.** Each action is a one-key map named after the existing Case Script action. Most actions also have a scalar short form (`tap: Home`, `wait: 500`, `assert: Welcome`).
- **Legacy JSON.** A legacy `.yoqa.json` file (one that has `savedAt`) still loads everywhere.
- **Shell.** Shell is now a secondary export. Pasting or opening shell in the Inspector converts it to YAML once.
- **Replay.** The CLI and the Inspector now share one client-side replay, `runCaseScript`. Catalog Runs keep using the runner's Case executor.
- **Rejected:**
  - a separate "Flow" model or `yoqa flow` commands (the name clashes with catalog Flows)
  - `.yoqa/flows/` project storage
  - new `screenshot` / `longPress` / `launch` actions (tap `durationMs` and `restart-app` / `activate-app` already cover them, and every replayed Action already has a Result screenshot)
  - moving CLI and Inspector replay onto the runner's Case executor (a follow-up)

## What shipped

**`@yoqa/runner-client`**
- New Case Script file codec:
  - `parseCaseScriptFile` reads YAML or legacy JSON. Every error names its line and action. Unknown keys and unknown actions are rejected. It also returns `actionLines`, and `allowEmpty` lets the Inspector parse a script with no actions yet.
  - `formatCaseScriptFile` writes canonical YAML: one action per line, a stable key order, short forms where possible, and quoting that is safe inside `{ … }` maps.
  - Helpers for legacy input: `toCaseScriptFileText`, `shellToCaseScriptFile`, `caseScriptFileLinesFromShell` and `looksLikeShellScript`.
- New shared replay:
  - `runCaseScript(client, script, { onStep, signal })` honours `wait.ms` exactly, polls asserts, stops at the first failure and reports later actions as `skipped`.
  - `caseScriptActionRequest` and `caseScriptActionCommand` turn an action into its runner request and its `yoqa` command line.
- `caseScriptActionSchemaByType` validates one action per type.
- `formatCaseScriptJson` is removed. The shell export header now points at the YAML file.
- Adds the `yaml` dependency (v2.9.0, already in the lockfile through lint-staged and vite).

**CLI**
- `yoqa script run <file>` reads YAML or legacy JSON through the codec and replays with `runCaseScript`. This fixes the old 500–3000 ms clamp on every `wait`.
- New `yoqa script validate <file>`: offline, without starting the runner. It exits 1 when there are errors.
- New `yoqa script export <app> <number> [--format yaml|shell] [--out <file>]`.
- `cases create|update --script-file` accepts YAML.

**Desktop**
- **Inspector:**
  - The editor holds a Case Script file. Recording, the element-action dialog's Insert / Insert & Run, and the Swipe and Wait helpers all append YAML action lines (the dialog still builds `yoqa` terminal commands for Copy).
  - Run highlights each action by its line.
  - **Open** loads `.yoqa.yaml`, `.yml`, `.yoqa.json` or `.sh`. Pasting shell converts it.
  - Export offers `.yoqa.yaml`, `.sh` and the reports.
  - **Save as test case** saves exactly what is in the editor. There is no lossy conversion any more.
- **Test Case Script tab:**
  - The views are Steps / YAML / Shell. **Edit YAML** shows errors with their lines.
  - **Export YAML** and **Export shell** are available. Export JSON is removed.
  - **Import…** replaces the Case Script from a file, and also appears in the empty state.
- The Expo demo CI smoke uses [`examples/expo-demo/yoqa/smoke.yoqa.yaml`](../../examples/expo-demo/yoqa/smoke.yoqa.yaml).

## How to verify

1. Unit tests: `bun test packages/runner-client/src/case-script-file.test.ts packages/runner-client/src/case-script-replay.test.ts apps/desktop/src/mainview/features/inspector/utils/script-steps.test.ts`
2. `yoqa script validate examples/expo-demo/yoqa/smoke.yoqa.yaml` prints `ok … 8 actions`. Break an action name and it prints `Line N, action M: …` and exits 1.
3. Connect a device. `yoqa script run examples/expo-demo/yoqa/smoke.yoqa.yaml` prints `ok …` per action and then `done 8 steps`. A failing action prints `error …`, then `skipped …` for each remaining action, and exits 1.
4. Inspector: double-tap elements and check that `- tap: …` lines appear under `actions:`. Run the script and watch each step highlight. Export `.yoqa.yaml`, then open it again. Paste an old `yoqa` shell script and check that it converts. Save as test case and check that the case's Script tab shows the same actions.
5. Test Case Script tab: Edit YAML, introduce a typo, and check that the error names the line. Use Import… with a legacy `.yoqa.json` file.

## Follow-ups

- Replay from the CLI and the Inspector through the runner's Case executor, so all three paths are one.
- Keep YAML comments when a Case Script is saved to the catalog. This would mean storing the file text next to the JSON.
- A `.yoqa/flows/`-style project folder, if the desktop app gains a project directory.
