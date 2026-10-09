# yoqa-sim framebuffer and HID input (`device-sim`)

## Goal

Ticket [#240](https://github.com/Aris-ngoy/qa-agent/issues/240) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-sim`](../plans/device-lanes/device-sim.md) third slice). The goal is the real `yoqa-sim` server:

- frames from the simulator's framebuffer, served from memory;
- touch input through the HID channel Simulator.app uses;
- the control API (`/tap`, `/swipe`, `/key`, `/display`, `/shutdown`).

The opted-in iOS-simulator Direct lane sends its input through it, in 0.0–1.0. It also gets a frame hash for later caching.

Targets, measured at the socket: a warm `/tap` under 30 ms, and `/screenshot` under 5 ms.

## Plan summary

- **Private frameworks, called at run time from Objective-C (`SimBridge`).** The work was reverse engineered against Xcode 27. idb's FBSimulatorControl was the reference for the approach only; no code was copied.
  - **Device:** `SimServiceContext` → device set → `SimDevice`. It must be booted.
  - **Frames:** the main display's port descriptor (`SimDisplayIOSurfaceRenderable` / `SimScreen`) exposes `framebufferSurface` and `registerScreenCallbacks…frameCallback:`.
  - **Input:** `SimulatorKit.SimDeviceLegacyHIDClient` sends Indigo messages that `IndigoHIDMessageForMouseNSEvent` builds.
    - Disassembly gave its signature: point, second point, target `0x32`, event type, edge, width, height. The point is divided by the size, so passing 1×1 sends fractions.
    - A move sent sooner than about 16 ms after the previous one comes back NULL, so swipe moves are spaced 17 ms apart.
- **Frames are encoded once per frame.**
  - A new frame from the display bumps a sequence number.
  - The quarter-scale JPEG preview, and any format read in the last 2 s (such as the Lane's PNG), are then encoded in the background. Frames that arrive during one warm-up are coalesced.
  - Anything else is encoded on first request and cached until the next frame.
  - Capture and encoding run outside the store's lock, so a slow encode never blocks another read.
  - The IOSurface is locked read-only while it is copied, so a frame never tears.
  - It is one latest-frame buffer, not a ring: only the latest frame is ever read.
  - An idle screen sends no frames, so it is served from memory.
- **Frame hash.** FNV-1a over a 64-pixel-wide thumbnail, sent as `X-Frame-Hash` (with `X-Frame-Seq`). The Lane reports it as `CapturedFrame.hash`.
- **The Lane asks for full-size PNG** (`scale=1&format=png`). The Result screenshot is the raw ground truth, and the runner assumes PNG elsewhere (pointer sizes, Agent images). The quarter JPEG stays the default for the live stream (#241).
- **Settle is unchanged and needs no `capturedAt`.** The framebuffer only changes when the screen does, so two identical reads 160 ms apart do mean stable.
- **Input.**
  - `/tap` is Down, a hold of 16 ms (never less, so a zero-length tap is never sent), then Up.
  - `/swipe` is Down, moves every ≥ 17 ms over `durationMs` (200 ms by default), then Up.
  - Gestures run one at a time on a HID queue. A request returns once Up is delivered; it doesn't wait for the app.
- **Home is a swipe up from the bottom edge (edge 3), not a button.** Measured: `IndigoHIDMessageForButton` messages (home `0x0`/`0x191`, lock `0x1`, consumer-page usages) are delivered but have no effect on an iOS 26.5 simulator, while an edge swipe goes Home on a Face ID iPhone. `/key` accepts `home` only, and any other key gets a 400. The plan's "volume" key is dropped.
- **Start fails before `api_ready`** when the frameworks don't load, the simulator isn't booted, or it has no display or HID channel. The Lane then falls back to idb_companion (#239).
- **Lane:**
  - Taps, swipes, drags, live pointer events, alert buttons and background-app's Home go to `yoqa-sim` in 0.0–1.0, converted at the Lane's edge (0–1000 / 1000).
  - Both coordinate spaces are the full screen, so fractions need no size.
  - A live pointer drag uses `yoqa-sim`'s default swipe duration.
  - **No gesture is ever sent twice.**
    - Only a `yoqa-sim` that can't be reached (`YoqaSimUnreachableError`: connection refused) makes the session stop it and send that gesture, and every later one, with idb_companion, with a Lane warning.
    - A refusal or a timeout may already have touched the screen, so it fails the action instead and `yoqa-sim` stays in use.
    - Frame reads fall back on any failure, since reading twice is harmless.
  - A gesture that fails after Down still sends Up, so no finger stays on the screen.
  - The first gesture waits for `yoqa-sim` to start (once per session).
  - Typing, app lifecycle and the tree stay on idb_companion.
- Rejected:
  - `simctl io screenshot` per request (~530 ms, #239);
  - encoding every frame at full size in the background (wasteful while nothing reads it);
  - serving quarter-scale JPEG to the Lane (it would degrade the Result screenshot).

## What shipped

- `native/yoqa-sim/`
  - `Sources/SimBridge` (Objective-C): `YSSimulator`, with device lookup, the main display, `touch(phase,x,y,edge)`, `copyFramebuffer` and `observeFrames`.
  - `YoqaSimCore`:
    - `TouchPlan`: tap, swipe and Home sequences.
    - `FrameStore`: per-frame encoding cache and hash.
    - `Controller`: routes, and the HID queue.
    - `HTTP`: request bodies and response headers.
  - `yoqa-sim`: `SimulatorDevice` wraps `YSSimulator` for the core. The `simctl` screenshot path is removed.
  - Tests (29):
    - touch plans;
    - frame store, with synthetic images;
    - routes, with a fake device;
    - the binary itself: an unknown simulator exits before `api_ready`, and a booted one (found with `simctl`, skipped without one) serves `/display` and PNG frames with stable hashes, and exits when stdin closes.
- `services/runner/src/domains/devices/`
  - `yoqa-sim.ts`: `YoqaSim.frame()` (PNG plus hash), `tap`, `swipe` and `key`. A refused command rejects with yoqa-sim's reason.
  - `ios-direct-lane.ts`: `viaYoqaSim` for frames and every gesture, with the fallback to idb_companion.
  - `lane.ts`: `CapturedFrame.hash`.
  - Tests: client calls (fake process and server), Lane routing and fallbacks, and the Lane contract harness, whose fake yoqa-sim now takes the taps.

## Measurements

iPhone 17 Pro simulator (iOS 26.5, 1206×2622 @3x), Xcode 27, Apple silicon, release build, measured at the socket from Bun:

| Call | p50 | max |
| --- | --- | --- |
| `GET /screenshot` (quarter JPEG, latest frame) | 0.2–0.3 ms | 0.4 ms |
| `GET /screenshot?scale=1&format=png`, unchanged frame | 1.3 ms | 78 ms (the first read after a new frame encodes, ~23 ms) |
| `POST /tap`, warm, 16 ms hold | 20.6–20.7 ms | 21.6 ms |
| The Lane's PNG reads while Settings animates (47 reads, 20 ms apart) | 1.5 ms | 69 ms (a read that beat the background encode) |

- Tapping the Settings icon changed the frame hash 105 ms later.
- Through the Lane (idb `describe` stubbed, since idb_companion isn't installed here):
  - a tap with `screenshot: true` returned its Result screenshot after Settle in 1.0 s, while Settings was still opening;
  - a 300 ms swipe took 366 ms;
  - background-app went Home;
  - idb_companion received no input.

## How to verify

1. `cd native/yoqa-sim && xcrun swift test` (boot a simulator first to run the live process test).
2. `bun test ./services/runner/src/domains/devices/{yoqa-sim,ios-yoqa-sim-lane,lane-contract}.test.ts`
3. Live:
   - `xcrun swift build -c release`.
   - Start the runner with `YOQA_DIRECT_IOS_SIMULATOR=device-sim` (idb_companion installed) and connect a booted simulator on the Direct lane.
   - Tap, swipe and background the app; each should act within tens of milliseconds.
   - `curl 'http://127.0.0.1:<port>/screenshot' -D -` shows `X-Frame-Hash`.

## Follow-ups

- #241: the MJPEG stream from the same frame store. #242–#244: the tree from `yoqa-ax`, cached by `X-Frame-Hash`.
- Hardware buttons (lock, volume, Home on a Touch ID model) need another channel. Find out what Simulator.app's Device menu sends on this runtime.
- `device-sim` is still opt-in. Promotion (#245) needs the benchmark against idb_companion on a machine that has it installed.
- Ship the binary with the runner (build and sign it in release CI).
