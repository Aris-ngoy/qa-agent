# Agent + CaseScript swipe

## Goal

Let catalog cases that say “scroll up / down” actually scroll. The agent previously had no swipe action, so it tapped the screen and still marked the run passed.

## Plan summary

- Add `swipe` to the vision JSON schema (`direction` or `x,y,x2,y2` on the 0–1000 screenshot grid).
- Finger direction matches Inspector: **up** = y 800→200 (scroll content down); **down** = y 200→800 (scroll content up).
- Persist expanded coordinates on CaseScript so replay does not need the model.
- Inject swipes in **screenshot** coord space (same as coordinate-only taps).
- Rejected: treating a mid-screen tap as a scroll; aliasing `type: "scroll"` without remapping finger vs content direction.

## What shipped

- Agent: `{"type":"swipe","direction":"up|down|left|right"}` or explicit endpoints; prompt never uses tap to scroll.
- Runner: `executeAgentCase` / `executeScriptCase` call `performAction({ kind: "swipe", … })`.
- `session.swipe(..., { coordSpace: "screenshot" })` for `kind: "swipe"` (drag stays window).
- CaseScript + `shellToCaseScript` + CLI `yoqa script run` + Script tab summary.
- Prompt-only swipe was not enough: run `run_4a84c` still tapped `(270,900)` eight times, noticed the list did not move, and **passed**. The executor now:
  - Rewrites tap/wait whose reason/thoughts mention scroll/swipe into a finger swipe.
  - On “scroll until you cannot scroll anymore”, rejects verify/done until a swipe has run **and** the next screenshot stopped changing.

## How to verify

1. Open a case whose instructions are “scroll up … wait … scroll down to the bottom”.
2. Run with **Use AI agent** (not the old saved script — that is still taps).
3. Steps should show **Swipe down** then **Swipe up** (finger direction), and the list on device should move.
4. After a passed agent run, Script tab has `{ type: "swipe", x, y, x2, y2 }`. Replay in script mode performs the same swipes.
5. Inspector command bar **Swipe up/down** → Save as test case keeps swipe instead of skipping it.
6. Case “Scroll down until you can not scroll anymore”: steps must be **Swipe up** (finger) until the screenshot stops changing, then verify — never a pass from repeated taps at the same point.

## Follow-ups

- `scrollUntilVisible` (keep swiping until a label appears)
- Full CLI action parity (drag, app lifecycle, assert, screenshot+tree decide) — see `docs/runs/agent-cli-parity.md`
