# Android: latest frame from a background capture (`device-android`)

## Goal

Ticket [#237](https://github.com/Aris-ngoy/qa-agent/issues/237) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-android`](../plans/device-lanes/device-android.md) first slice). On the Android Direct lane, capture-frame (used by Settle, the live preview and grounding) should read the latest frame from a background `screencap` loop instead of running `screencap` per call. Input must never wait on capture. The Result screenshot still comes from Settle, and Settle's cap, poll and stable window are unchanged.

## Plan summary

- **A new Direct implementation, not a new Lane.** `device-android` is registered in `DIRECT_IMPLEMENTATIONS.android` ahead of `adb`, without `promoted`. It is the same adb session with `backgroundCapture` on. It runs only with `YOQA_DIRECT_ANDROID=device-android`, and it falls back to `adb`, then Appium, as set up in [device-lanes-foundation.md](./device-lanes-foundation.md).
- **Freshness after input.** A latest-frame source can serve a frame captured before a tap. So every shell command that can change the screen records when it finished, and capture-frame returns only a frame whose capture *started* after that. A read never starts an adb capture itself. It waits for the loop.
- **A kick on input.** Measured: with a strictly serial loop, a read after a tap waited for the rest of the capture already in flight plus one whole new capture, and tap-to-result got worse than per-call `screencap` (~3.3 s vs ~2.3 s on a cold emulator). Now input starts one extra capture right away, next to the one in flight (at most one extra at a time). A post-tap read then waits for one capture, as the per-call lane does.
- **Settle times stability by capture time.** A cheap source returns the same capture to several polls. Counting those as "the same frame held for 160 ms" would settle on one sample. `CapturedFrame` gains an optional `capturedAt`. When it is present, `settleScreen` measures the stable window between capture start times, so it needs two distinct captures of the same image. Lanes without `capturedAt` behave exactly as before. Rejected: changing Settle's constants. That is a separate, benchmark-gated change (#233).
- **Idle pause.** The loop starts on the first read and pauses after 2 s without one, so an idle session doesn't keep `screencap` running on the device.
- Rejected: starting the loop at connect (it burns device CPU for sessions that never read frames), and a frame ring buffer (only the latest frame is ever read).

## What shipped

Under `services/runner/src/domains/devices/`:

- `frame-loop.ts`: `createFrameLoop(capture)` with `read(after)`, `kick()` and `stop()`.
  - A Dead Session from the tool stops the loop and fails every later read.
  - Another capture error fails the reads waiting at that moment, then the loop retries after 100 ms.
  - Overlapping captures never replace a newer frame with an older one.
- `android-direct-lane.ts`: `AndroidDirectDeps.backgroundCapture`.
  - Read-only shell commands (`uiautomator dump`, `cat`) go through `readShell`. Every other shell command marks input and kicks the loop.
  - Quit stops the loop.
  - The screenshot-space pointer size uses any frame, so it never waits for a post-input one.
- `direct-lane.ts`: the `device-android` registry entry (not promoted).
- `lane.ts`: `CapturedFrame.capturedAt`.
- `action-result.ts`: `settleScreen` uses `capturedAt` when present.
- Tests:
  - `android-latest-frame.test.ts` uses a gated fake adb whose `screencap` finishes only when the test says so. It checks that reads never start a capture, a tap never waits for capture, a read after a tap returns a post-tap frame after one new capture, the loop pauses when idle, and quit stops it.
  - The Lane contract suite runs `device-android` as a fifth harness and gains one check for every Lane: capture-frame after a tap shows the screen after that tap.
  - `select-lane.test.ts` pins the real registry: `adb` is the default, and opting in tries `device-android` first.

## Measurements

Pixel_8 AVD (API 36, 1080×2400) on Apple silicon, runner from this branch. 20 taps per run after 3 warm-up taps, at the status bar (`x 500, y 12`). Three interleaved warm pairs, p50:

| Metric (at the runner, over HTTP) | `adb` | `device-android` |
| --- | --- | --- |
| `GET /screenshot/image` (frame only) | 545–623 ms | 1–2 ms |
| `POST /action` tap, then the next frame | 601–657 ms | 604–2006 ms (two runs at 604–611) |
| `POST /action` tap with `screenshot: true` (Settle) | 1509–1675 ms | 1132–2191 ms (two runs at 1132) |

One `device-android` pair ran while the emulator slowed down across the board (2.0 s and 2.2 s). Both of its other pairs and every `adb` pair were steady.

- **The ticket's < 100 ms target is not met, and can't be with this capture.** `screencap -p` itself takes ~550 ms on this emulator (PNG encoding of 1080×2400 on the device), so the first frame after a tap costs at least one capture on either implementation.
- What the loop does buy: the live preview and any non-input frame read drop from ~550 ms to ~1 ms. Tap-to-result with Settle is ~25 % faster in steady runs, because Settle's second, confirming capture is already in flight.
- **Not promoted.** ADR-0004's gate needs a measured gain against the current lane. The steady runs show one, but one of three warm pairs didn't, and the headline target is missed by a factor of six. It stays opt-in until a faster capture source exists.

## How to verify

1. `bun test services/runner/src/domains/devices/{android-latest-frame,lane-contract,action-result,select-lane}.test.ts`
2. `bun run check`, `bun run lint:ci`, `bun run test`.
3. Live: boot an Android emulator, then start the runner with `YOQA_DIRECT_ANDROID=device-android`. Connect on the Direct lane and time `GET /screenshot/image` (~1 ms once warm) against a runner without the variable. Taps and Result screenshots must look the same as before.

## Follow-ups

- **A faster capture source** is what the 100 ms target needs. Candidates: raw `screencap` (no `-p`) with PNG encoding in the runner, a downscaled capture, or the plan's second-slice instrumentation APK serving frames. Measure each against this loop.
- Run the same comparison on a physical Android phone. `screencap` cost differs a lot from the emulator's.
- Promote `device-android` (set `promoted: true`) only after a repeatable gain across runs.
