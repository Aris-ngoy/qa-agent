# Run details layout

## Goal

Make a finished run read like the Run details artboard: a status chip and the case title, a single line for the device, the time, the step count, and the duration, then numbered steps beside a phone screenshot.

## Plan summary

- Restyle the detail page in the desktop app. The shared sidebar and session bar stay as they are; the artboard redraws them, and they belong to every page.
- The mono line is model, OS and version, the full device id, the list date, the step count, and the wall-clock duration (`38s`, `1m 30s`). Duration is omitted when the run never started. A live run uses the time so far.
- Each step is a number, the action, the yoqa command, and Passed or Failed. Decision and Verify sit on labeled rows. Verify is green when it passed, red when it failed, and muted while it is still pending. AI thoughts still expand under the step.
- The screenshot sits in a phone frame. In review, bars under it pick the step, and the caption says `step 4 / 4`.
- Stop, export, video playback, jump-to-latest, and the error line stay. A case failure still shows that case's error. A run with more than one case names each case above its steps.
- Rejected: copying the artboard's markup and hex colors. The page uses the existing theme tokens so light and dark keep working.

## What shipped

- `labels.ts` — `formatRunDuration`, `formatRunDetailMeta`.
- `detail-page.tsx` — chip, title, meta line, export buttons, step rows, phone frame, and step pager.
- `screenshot-crossfade.tsx` — the image fills the phone frame.

## How to verify

1. `bun test apps/desktop/src/mainview/features/runs/labels.test.ts`
2. Desktop, open a passed run: a green Passed chip, the case title, and a mono line with the model, OS, full device id, date, step count, and duration.
3. Each step shows its number, action, command, and Passed or Failed, then Decision and Verify. AI thoughts still expands.
4. The screenshot is in a phone frame. The caption is `step n / n`. Click a bar or a step and that step's screenshot shows.
5. A live run still shows Stop, the executing row, and Jump to latest. A failed case still shows its error. Export HTML and Export Markdown still download after the run finishes.

## Follow-ups

- none
