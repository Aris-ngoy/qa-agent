# Yoqa walkthrough video

## Goal

A muted, 1920×1080, 30fps walkthrough of Yoqa: real desktop, iOS Simulator, and CLI footage, with Remotion only adding the open, chapter cards, lower thirds, a split stage, and the close.

## Plan summary

The project lives in `apps/video`, the same pattern as `apps/docs` and `examples/expo-demo`: its own `package.json`, not a Bun workspace. `apps/video/.npmrc` sets `workspaces=false` so npm does not walk up into the Bun root and fail on `workspace:*`. Biome ignores `apps/video/**`. There is no CI render job.

The scripted smoke in `examples/expo-demo/yoqa/smoke.yoqa.json` is what was filmed. Script mode does not depend on a provider and matches the in-repo fixture. A title card states that a passing AI run can be saved and replayed as a script.

Rejected: motion-graphics stand-ins for the device or the desktop. Full-screen ffmpeg AVFoundation capture (it either hung or included the whole display). Padding static UI out to three minutes (it reads as a freeze).

## What shipped

- `apps/video` — Remotion 4 composition `YoqaWalkthrough` (`src/YoqaWalkthrough.tsx`). Scenes: open (mark, “Local-first agentic mobile QA”), desktop, test case, “Perceive, decide, act” card, split run (desktop Runs + phone frame), CLI, close (`yoqa.mintlify.site/docs/quickstart`). Shared pieces: `YoqaMark`, `TitleCard`, `LowerThird`, `ClipStage`, `SplitStage`. The mark is copied from the desktop splash (ink `#14131c`, lavender `#e3dbf7`, Inter).
- Source clips in `apps/video/public/captures/`: `desktop.mp4`, `test-case.mp4`, `run-desktop.mp4`, `simulator.mp4`, `cli.mp4`.
- Render output `apps/video/out/yoqa-walkthrough.mp4` is gitignored, along with `apps/video/.capture-scratch/`.
- The cut is about 75 seconds. Scene lengths follow the clips (`src/theme.ts`).

## How to verify

From `apps/video` (npm, not bun):

```bash
npm install
npm run studio   # preview
npm run render   # writes out/yoqa-walkthrough.mp4
```

Re-record (screen-recording permission required). Boot the desktop (`bun run desktop`) and install the Expo demo on a simulator (`examples/expo-demo`: `npx expo run:ios`). Seed the catalog with `bash examples/expo-demo/yoqa/seed-catalog.sh`, then attach the smoke script:

```bash
yoqa cases update DEMO 1 \
  --flows-file <flow.json> \
  --script-file examples/expo-demo/yoqa/smoke.yoqa.json
```

- Simulator (device pixels only): `xcrun simctl io booted recordVideo --codec h264 simulator-raw.mp4`, while `yoqa runs create DEMO --cases 1 --mode script --wait` runs.
- Desktop window and Terminal: `screencapture -l <CGWindowID>`. Crop the Terminal title bar before encoding so the username and hostname are not in the clip. Replace the files under `public/captures/`, then keep the frame counts in `src/theme.ts` inside each clip’s duration.

## Follow-ups

- Voiceover.
- An AI-mode run, once a provider is configured, in place of the scripted smoke.
- A cold-start reshoot: reinstall `YoqaDemo.app` so the counter starts at 0, and record the desktop Runs window and the simulator in the same passing take. The current split pairs a “Running” desktop take with a later passing simulator take, and the demo counter was not reset.
