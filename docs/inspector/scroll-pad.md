# Inspector Scroll pad

## Goal

The Inspector's swipe arrows felt backwards: pressing ↑ moved the page down. The arrows named the finger's movement, while a person reaching for an arrow means "show me what's up there". Make the pad say what it does.

## Plan summary

- A `swipe` Action keeps its meaning: its direction is the way the finger moves. `CONTEXT.md` now says so under **Action**, and that scrolling up is swiping down. The Run agent, `yoqa action swipe --direction` and the browser wheel already follow this.
- Rejected: flipping `swipe` everywhere. Every saved Case Script and the agent's guidance would silently reverse.
- The Inspector pad becomes **Scroll**: an arrow points at the content to reveal, and the pad writes the opposite finger swipe. All four directions follow the same rule.
- The Test Case step list names a coordinate swipe the same way ("Scroll up"), so the label on the pad matches the step it recorded.

## What shipped

- Inspector **Screen gestures**: the pad is labelled Scroll (button labels "Scroll up" etc.). **Scroll ↑** writes `# scroll up` and `swipe: { x: 500, y: 200, x2: 500, y2: 800 }`. ↓, ← and → are mirrored the same way.
- Test Case script panel: a coordinate swipe reads "Scroll up/down/left/right" for the way the content moves.
- `CONTEXT.md` **Action**: swipe direction is finger movement.

## How to verify

- `bun test apps/desktop/src/mainview/features/inspector/utils/script-text.test.ts apps/desktop/src/mainview/features/test-cases/utils/script-summary.test.ts`
- In the Inspector, press **Scroll ↓** on a long list and run the script. The list moves to the content below. The script panel shows "Scroll down".

## Follow-ups

- Run reports (`actionSummary` in runner-client) still name a swipe by the finger ("Swipe up"), as the Action itself does. Switch them to Scroll wording if that reads better next to the step list.
- Case Scripts recorded with the old pad keep their coordinates and behaviour; only their `# swipe up` comment now reads the opposite way to the new pad.
