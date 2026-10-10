# Run recording

## Goal

Let a Run optionally produce a screen video of the whole flow, next to its Result screenshots. See **Run recording** in [CONTEXT.md](../../CONTEXT.md).

## Plan summary

- Chosen on the **Test Case** (Configuration tab "Record video", off by default), not in the runs header. `recordVideo` on a create-run request (CLI `--record-video`) overrides it to record every case.
- One video **per recorded case**, not per Run: each case's recording starts just before it executes and stops right after.
- The video shows on the Run detail page only after the Run has finished; no "recording" placeholder while it is live.
- Evidence only: Decide, Settle and the pass/fail outcome never depend on it. A Lane or device that cannot record leaves the Run unaffected and the case records why.
- Each Lane records natively: Appium `startRecordingScreen`, Android Direct `adb screenrecord`, iOS simulator Direct `simctl io recordVideo`, cabled-iPhone Direct (`device-ios`) frames captured on the phone by `YoqaRunner` and encoded by `ffmpeg`.
- Rejected: one video per Run, a header toggle, a live mid-Run toggle (partial video), ffmpeg stitching for Android's 3-minute cap (new dependency).

## What shipped

- `cases.record_video`; `CatalogCase.recordVideo` and the create/update case requests carry it.
- `run_tests.recording_status` / `recording_note`; `RunTest.recording` = `{ status: recording | ready | unavailable, note? }`.
- `recordCase` (`runs/run-recording.ts`) wraps one case's execution with a recording and turns every failure into `unavailable`; `executeRun` calls it per case.
- Files live at `~/.yoqa/runs/videos/<runTestId>.mp4`, served by `GET /runs/:runId/tests/:testId/video` (supports `Range`), and deleted with the Run. A recording cut off by a runner stop reads as `unavailable`.
- Desktop: "Record video" switch on the Test Case Configuration tab; the Run detail page lists each recorded case under the screenshot once the Run is finished; each is a button that opens a dialog with a player and a Download button.
- A video can be deleted from its dialog (Delete video, with a confirmation): `DELETE /runs/:runId/tests/:testId/video` removes the file and clears the case's recording; refused while the Run is still live.
- CLI: `yoqa runs create --record-video` forces recording for all cases and prints each video URL.

## How to verify

1. `bun run check && bun run test`.
2. Desktop: turn on Record video in a Test Case's Configuration tab, save, run it on a simulator; while it runs no video shows, and once finished the run page shows a playable video.
3. CLI: `yoqa runs create <app> --cases 1 --record-video --wait` prints a `video` URL per case.
4. Cancel a recorded Run: the video is still saved.

## Follow-ups

- Recording on **physical iPhones** (Appium lane, and `device-ios` via `frame-recorder.ts`) needs `ffmpeg` on the host (`brew install ffmpeg`, then restart Yoqa so the runner sees it); without it the case shows "Video unavailable" with that instruction. Simulators and Android Direct do not need it.
- Android Direct stops at 3 minutes (a `screenrecord` limit); longer Runs keep the first stretch. Stitching segments would lift it.
- No size cap or age-based pruning of videos (screenshots are pruned after 7 days). Videos can be large; delete the Run to reclaim space.
- Seek-to-step, run-report mention of the video, and a `--record-video` flag on `cases create/update`.
- `device-ios` has no native video API (XCUITest cannot record). `YoqaRunner` captures half-size JPEGs in a background thread on the phone (`recordStart`, about 8 a second; `FrameRecorder.swift`), the Mac pulls them in batches (`recordFetch`, every 400 ms) and `ffmpeg` encodes them with each frame held for its real gap, so the video plays in real time. This is the idea behind Appium's WDA MJPEG server, with a pull instead of a push, and it avoids a cable round trip and PNG per frame. A runner that lacks the commands, or whose capture fails, falls back to Mac-side screenshots. Frames are capped at 64 MB on the phone and a recording the Mac stops pulling for 60 s stops itself.
- Rejected for `device-ios`: the cable's real screen feed (ffmpeg `avfoundation`). macOS lists it only to a process that sets `kCMIOHardwarePropertyAllowScreenCaptureDevices`, then needs Camera permission for the host app, which was denied here with no frame delivered. Argent does not record physical iPhones at all.
- Measured on 2026-10-10 on an iPhone 15 (iOS 27.0.1): an 11 s recording with three swipes gave a 590x1278 H.264 file of about 0.5 MB. The phone's real capture rate is unmeasured; a slow capture lowers smoothness, not the video's length.
- Appium/Android are not exercised on real devices; only unit-tested. `device-ios` was run once on a phone as above.
