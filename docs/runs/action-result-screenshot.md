# Action result screenshot (`--screenshot`)

## Goal

Give external coding agents Argent's "act, then see the result" loop, built on screenshot + `x,y`, so they can test games, where there is no accessibility tree. Before this, `yoqa action tap` printed `ok tap` and the agent had to run a separate `yoqa screenshot` (and guess whether the screen had finished reacting).

Vocabulary: **Settle** and **Result screenshot** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Borrowed from Argent:** every interaction returns the screen afterwards, and the caller waits for the screen to be idle first. **Not borrowed:** the element tree and tree-derived coordinates; games have none (see [vision-first-screen-mode.md](./vision-first-screen-mode.md) for the prior art note).
- **Opt-in per call** (`--screenshot`), so exported shell scripts, CI and Inspector snippets keep their output and speed. The `yoqa-testing` skill tells agents to always pass it on games.
- **Lives in the runner** (`/action` with `screenshot: true`), not the CLI: one HTTP call on the held Device Session, with no gap between action and capture, and every client gets it.
- **Settle** = two consecutive identical frames, capped (default 1500ms, `--settle <ms>`, max 10s). A game that never stops animating returns the latest frame with `settled: false`.
- **`changed`** compares the frame before the action with the settled result. It is only claimed when the screen settled; otherwise `null`, because on an animating screen "changed" is always true and would mislead the agent.
- **Annotated copy** marks where a tap landed (ring) or a swipe/drag went (green start dot, line, ring at the end). The raw image stays the ground truth. Reuses the in-repo PNG codec in `coord-grid.ts`; no new dependency.
- Scope scenarios: onboarding and menus, animated home screens, ads and system sheets, swipe/drag. **Out of scope:** timed or real-time gameplay (a coding-agent round trip takes seconds); use a Case Script.
- Rejected: always-on (changes default output and slows scripts); CLI-side polling (every client reimplements it, race between action and capture); pixel-diff tolerant idle (needs tuning; exact match plus a cap is enough for now); a ruler or `--grid` on the marked copy (only the marker was chosen).
- No ADR: additive and easy to remove.

## What shipped

- [`action-result.ts`](../../services/runner/src/domains/devices/action-result.ts): `settleScreen`, `actionMarks`, `performActionWithScreenshot`.
- [`coord-grid.ts`](../../services/runner/src/domains/runs/coord-grid.ts): `paintActionMarks` / `overlayActionMarks`.
- [`schemas.ts`](../../packages/runner-client/src/schemas.ts): `screenshot` and `settleMs` on `ActionRequest`; `screenshot` (`path`, `annotatedPath`, `settled`, `waitedMs`, `changed`) on `ActionResponse`. Additive.
- [`/action` route](../../services/runner/src/interfaces/http/session.ts) uses it when `screenshot` is true.
- CLI: `yoqa action <kind> --screenshot [--settle <ms>]`, including `alert`. `--json` returns the full object.
- `yoqa-testing` skill, CLI reference and the Games guide describe the loop.
- Known approximation: a `--label` / `--id` tap resolves in window space, so its marker can sit a few units off in the screenshot space.
- `yoqa action` steps inside a shell script ignore `--screenshot`.

## How to verify

1. Restart the runner sidecar and connect a device.
2. `yoqa action tap --x 500 --y 500 --screenshot`. It prints `screenshot`, `marked`, `settled` and `changed`. Open `marked`: a ring sits on the point.
3. On a static screen, tap a dead spot: `settled true`, `changed false`.
4. On an animating game screen: `settled false`, `changed unknown (screen still animating)`, and the images are still returned.
5. `yoqa action swipe --x 500 --y 700 --x2 500 --y2 300 --screenshot`: the marked copy shows the line from start to end.
6. Without `--screenshot` the output is unchanged (`ok tap`).
7. Tests: `bun test services/runner/src/domains/devices/action-result.test.ts`.

## Follow-ups

- Let the Run agent use the same settle (it still sleeps a fixed `POST_ACTION_SETTLE_MS`).
- A tolerant (pixel-diff) idle for games with constant small animations, if the cap is hit too often.
- Honour `--screenshot` in shell scripts if the Inspector needs it.
