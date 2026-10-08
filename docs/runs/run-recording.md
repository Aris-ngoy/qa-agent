# Run recording

## Goal

Let a Run optionally produce a screen video of the whole flow, next to its Result screenshots. See **Run recording** in [CONTEXT.md](../../CONTEXT.md).

## Plan summary

- Opt-in per Run (`recordVideo`), off by default, chosen before the Run starts. No global setting.
- One video per Run, not per Test Case. Plain player; no seek-to-step.
- Evidence only: Decide, Settle and the pass/fail outcome never depend on it. A Lane or device that cannot record leaves the Run unaffected and the Run says why.
- Each Lane records natively: Appium `startRecordingScreen`, Android Direct `adb screenrecord`, iOS simulator Direct `simctl io recordVideo`.
- Rejected: per-Case clips (no need for a "whole flow" video), live mid-Run toggle (partial video), ffmpeg stitching for Android's 3-minute cap (new dependency).

## What shipped

- `createRunRequest.recordVideo`; `Run.recording` = `{ status: recording | ready | unavailable, note? }`.
- `DeviceSession.startRecording(path)` on all three Lanes; `runs/run-recording.ts` wraps it so failures become `unavailable` instead of errors.
- `executeRun` starts the recording once the session is acquired and stops it before the session is released, including on cancel or error.
- Files live at `~/.yoqa/runs/videos/<runId>.mp4`, served by `GET /runs/:runId/video` (supports `Range`), and deleted with the Run. DB columns `record_video`, `recording_status`, `recording_note`.
- Review fixes: the detail page keeps polling until the video is finalized; a recording cut off by a runner stop reads as `unavailable`; starting a recording can no longer fail a Run; Android stop signals only its own `screenrecord` pid and reports `unavailable` if the file is not finalized; stopping is bounded to 20s; unsatisfiable `Range` returns 416; a video is removed if its Run was deleted mid-recording.
- Desktop: a "Record video" toggle in the runs panel header; the Run detail Screenshot panel shows the player, or the reason it is unavailable.
- CLI: `yoqa runs create --record-video`.

## How to verify

1. `bun run check && bun run test`.
2. Desktop: toggle Record video, start a Run on a simulator, open the Run once it finishes; the Screenshot panel shows a playable video.
3. CLI: `yoqa runs create <app> --cases 1 --record-video --wait` prints a `video` URL.
4. Cancel a recorded Run: the video is still saved.

## Follow-ups

- Android Direct stops at 3 minutes (a `screenrecord` limit); longer Runs keep the first stretch. Stitching segments would lift it.
- No size cap or age-based pruning of videos (screenshots are pruned after 7 days). Videos can be large; delete the Run to reclaim space.
- Seek-to-step and run-report mention of the video.
- Not yet exercised on real devices; only unit-tested.
