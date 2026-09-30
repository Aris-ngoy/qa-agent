# Game taps read a coordinate grid

## Goal

Stop the vision agent missing taps on games and other canvas screens, where there is no accessibility control to hit and a guessed `x,y` lands off the button.

## Plan summary

- Runs are [vision-first](./vision-first-screen-mode.md) by default: the screenshot and plain `x,y`, with no tree. **Grid mode** is for where plain `x,y` is known to miss. An `id` or `label` on the decision is dropped so the point is what runs. A system permission label such as Allow is kept.
- A case **starts** in Grid mode when app context or knowledge says the catalog app is a game (`mobile game`, `this is a game`, `unity`, `gameplay`, and the same family of phrases).
- Any other vision case is **escalated** into Grid mode after two consecutive `x,y` taps leave the screenshot unchanged, and stays there for the rest of the case. The step that triggered it records `escalatedToGrid: true`.
- In `tree` Screen mode (opt-in), a full-screen node (the Unity / WebView / GL surface) still switches the case into Grid mode, and a screen with fewer than three small named controls gets the grid for that step.
- In Grid mode the screenshot sent to the model gets a magenta grid. Each cell is labeled `column-row` (0-0 through 9-9) in its top-left corner. The model names that cell (`col`, `row`) and where inside it the centre sits (`qx`, `qy`, each 0–4). The runner computes `x,y` from those values. A reply that only contains a guessed `x,y` is asked once for the cell.
- Rejected: asking the model to read a coordinate off unlabeled grid lines (it still guesses); scaling screenshot pixels onto the window a second time (that map is already correct when the screenshot and the window are the same framing); snapping every guess to the nearest tree node (on a game that node is the whole screen).

## What shipped

- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts): `isGameApp`, `forceScreenshotTap`, `applyGridPoint`, a screenshot-only decide prompt, plus `isCanvasScreen` and `releaseCanvasPoint` (both tree mode only).
- [`coord-grid.ts`](../../services/runner/src/domains/runs/coord-grid.ts): draw the grid and the cell labels, and compute `x,y` from the named cell.
- [`case-executor.ts`](../../services/runner/src/domains/runs/case-executor.ts): Grid mode performs the computed `x,y`. A guessed point with no cell is sent back once. Game apps start in it, vision cases escalate into it, and a full-screen surface found in tree mode switches the rest of the case onto it.

## How to verify

1. Restart the runner sidecar.
2. Run a game case with **Use AI agent**.
3. Mark the app as a game in app context (for example "This is a mobile game"). The run should start in Grid mode without reading the tree. The step screenshot stays the raw device image. The image the model sees has magenta lines and a `column-row` label in each cell. The tap is the point computed from `col`, `row`, `qx`, and `qy`.
4. A normal login form does not get the grid until two `x,y` taps in a row change nothing. With `--screen-mode tree`, label/id taps still resolve from the tree.

## Follow-ups

- none
