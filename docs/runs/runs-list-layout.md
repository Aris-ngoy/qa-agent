# Runs list layout

## Goal

Make the Runs list match the Runs artboard: a status dot, the test and the device on two lines, a result chip, and All / Passed / Failed filters.

## Plan summary

- Restyle the list in the desktop app. The shared sidebar and session bar stay as they are; the artboard redraws them, and they belong to every page.
- The chip shows cases passed over cases in the run (`1 / 1`). Green when the run passed, red when it errored, a dash when it recorded no cases. A run that is still going, or was cancelled, stays on All with its own tone.
- Passed keeps runs that passed and had cases. Failed keeps errored runs. Empty, live, and cancelled runs stay on All.
- Rejected: copying the artboard's markup and hex colors into the app. The list uses the existing theme tokens so light and dark keep working.

## What shipped

- `apps/desktop/src/mainview/features/runs/list-page.tsx` — filter, caption (`Today · {device}` when a device is connected), and the table. The row opens the run. Delete stays on the row and shows on hover or keyboard focus. Rows still fade in once on first load.
- `labels.ts` — `runListResult`, `filterRuns`, `formatRunListDate` (`Oct 10, 11:38 PM`), `formatRunDeviceLines` (name and OS, then model and a shortened id), `formatRunContextCaption`.

## How to verify

1. `bun test apps/desktop/src/mainview/features/runs/labels.test.ts`
2. Desktop, Runs: a passed run is a green dot and a green `n / n` chip; a failed run is red; a run with no cases says Empty run and shows a dash. The device line is the name and OS, with the model and a shortened id under it.
3. Passed and Failed filter the list. All shows the count. With a device connected, the caption names it.
4. Hover a row (or tab to the trash control) and delete still removes that run.

## Follow-ups

- none
