# Vision-first Run agent

## Goal

The built-in Run agent decides from the screenshot and the instruction alone, and names where to tap as `x,y`. No accessibility tree ("screen metadata") is read or sent by default. Reading the tree every step cost time, pushed the model toward ids that are wrong on custom-drawn UI, and is irrelevant on games.

Vocabulary: **Screen mode**, **Grid mode**, and **Escalation** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Screen mode** is a per-Run setting: `vision` (default) or `tree` (opt-in). `tree` restores the previous behavior: screenshot plus the cleaned tree, with `id` targeting.
- **Default prompt** offers `x,y` for in-app taps and `label` only for system permission / notification sheets. `id` and `description` are not offered. The decision schema still parses them, so `tree` mode and saved runs keep working. If a reply names a control with no point, it is asked once for `x,y`, because an unresolved tap would land in the middle of the screen.
- **Grid mode** (labeled grid, model names `col`, `row`, `qx`, `qy`) still exists, for the case where plain `x,y` is known to miss: a game starts in it, and any other case is **escalated** into it. See [game-tap-grid.md](./game-tap-grid.md).
- **Escalation** fires after 2 consecutive `x,y` taps that leave the screenshot fingerprint unchanged. It is sticky for the rest of the case and is recorded on the step that triggered it (`escalatedToGrid: true` in the step action). Any other action in between (swipe, wait) resets the count. `tree` mode never escalates.
- **Skill and docs follow the same default.** The `yoqa-testing` skill and the public CLI docs tell external coding agents to take `yoqa screenshot` first and tap with `--x` / `--y` (centre of the control, 0–1000). `yoqa screen`, `--id`, and `--label` are the fallback: when the identifier is known from the code, or after two missed taps. The CLI commands themselves are unchanged. Scope was widened from "Run agent only" at the user's request.
- **Out of scope:** the `yoqa screen` CLI command itself, the Inspector, and the settings / catalog UI. The executor still reads the tree for `assert` steps, which are not model-visible.
- Rejected: deleting the tree code (executor-side `assert` and label resolution need it, and `tree` is a useful escape hatch); an env var as the only switch (global, not visible in run reports); a per-app setting (needs catalog schema and UI); a lazy tree fallback when taps fail (complicated, and Grid mode already covers the failure it would address); game detection from the tree (needs the tree read the default mode removes).
- No ADR: the default is easy to flip back with `screenMode`, so it fails the "hard to reverse" test.

## What shipped

- [`runner-client` schemas](../../packages/runner-client/src/schemas.ts): `runScreenModeSchema` / `RunScreenMode`; optional `screenMode` on `CreateRunRequest` and `Run`.
- [`runs` table](../../services/runner/src/domains/catalog/db.ts): `screen_mode` column. Rows from before this change read back as `tree`, which is how they ran. New runs store `vision` unless asked otherwise.
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts): `VISION_SYSTEM_PROMPT` (the tree prompt keeps `SYSTEM_PROMPT`; keyboard, swipe, and common rules are shared), a screenshot-only user prompt, `screenshotPointMissing`, and `NO_TREE_SNAPSHOT` in place of the game-only snapshot text.
- [`case-executor.ts`](../../services/runner/src/domains/runs/case-executor.ts): `screenMode` dep (default `vision`), no per-step tree read unless `tree`, `GRID_ESCALATION_TAPS = 2`, point-missing retry, `escalatedToGrid` on the step.
- [`application.ts`](../../services/runner/src/domains/runs/application.ts): persists and passes `screenMode` through `createRun` → `executeRun` → the case executor.
- CLI: `yoqa runs create --screen-mode vision|tree`.
- Run report: a **Screen** row in the HTML, Markdown, and GitHub summary tables for catalog runs.
- **Stuck-wait hint:** after 3 consecutive waits on an unchanged screenshot (`STUCK_WAITS`), the next decide is told to stop waiting and act on what is visible. It repeats while the screen stays unchanged. Waits still count toward the 25-step cap. Motivation: run `run_095e7779` (#7 Adjoe Tests, old tree mode) waited 14 steps behind an App Store "Install" sheet that the accessibility tree did not contain, and the tree's "Preparing to download" text overrode what the screenshot plainly showed.
- [`yoqa-testing` skill](../../packages/skill/yoqa-testing/SKILL.md) (SKILL, inspect, coordinates, grounding, assertions, debug-on-device) and the `apps/docs` guides (`cli-for-agents`, `cli`, `overview`, `introduction`, non-native UI, games): screenshot → act by x,y → verify, with `yoqa screen` as the fallback and a warning that the tree cannot see system sheets.
- **Repeat-tap hint:** after 2 taps within 30 units of each other that leave the screenshot unchanged (`REPEAT_TAPS`), the next decide is told that point is not on the control and not to tap it again (`repeatTapHint`). In Grid mode it also says to move to the neighbouring cell or `qx`/`qy` 0 or 4. Motivation: run `run_99fd66c2` tapped `50,150` seven times for a close X that the Inspector put at `97,114`. Grid mode snaps to the middle of a `qx`/`qy` slot (20 units wide), so a small control near a cell edge is missed every time, and the model kept choosing `qx=2, qy=2`. Plain `x,y` and the Grid answer are unchanged; only the retry prompt is new.
- **Label taps on system dialogs work in vision / Grid mode.** The executor passed its empty `screenElements` list to `performAction`, which treats any list as an already-read tree, so a tap on `label: "Allow"` could never match and always failed as "No element matching label". The model then fell back to coarse grid taps (run `run_9314a5e8` tapped around `470,750` for an Allow button the Inspector put at `500,679`, about 15 times). An empty list is now passed as "not read", so `performAction` reads the tree itself for that one tap. Regression test in `case-executor.test.ts`.
- Also fixed: a TypeScript narrowing error in `readStepCycle` that failed the typecheck gate.

## How to verify

1. Restart the runner sidecar.
2. Run a non-game case with **Use AI agent** (or `yoqa runs create APP --cases 1 --mode agent --wait`). The run report shows `Screen | vision`. Step timing shows `screen` at about 0ms. In the step detail, taps are `x,y`, not `id`.
3. Run the same case with `--screen-mode tree`. The report shows `Screen | tree`, the tree is read each step, and `id` taps work as before.
4. On a screen where the tap lands nowhere (for example a canvas not marked as a game), two consecutive `x,y` taps with no visible change turn the grid on for the next decide. The step that triggered it has `escalatedToGrid: true`.
5. Put a system sheet over an app (for example the App Store Install sheet) and run a case that needs it tapped: vision mode taps it by `x,y`. If a model still waits, the third unchanged wait adds the hint to the next prompt.
6. Skill: install it (Settings → CLI & Agents) and ask a coding agent to tap a button on a connected device. It should call `yoqa screenshot`, open the image, and use `yoqa action tap --x --y`, not `yoqa screen`.
7. Tests: `bun test services/runner/src/domains/runs packages/runner-client/src/run-report.test.ts`.

## Follow-ups

- Desktop Runs panel control for Screen mode (only the API and CLI expose it today).
- A catalog-app default for Screen mode, if teams want `tree` on specific apps without a flag.
- Grid mode is coarse for small controls (20-unit `qx`/`qy` slots). If the repeat-tap hint is not enough, options are finer slots, or snapping a missed tap to the nearest clickable node from a one-off tree read.
- Tune `GRID_ESCALATION_TAPS` from real runs. Animated screens change the fingerprint every frame and will not escalate, which is why games start in Grid mode.
