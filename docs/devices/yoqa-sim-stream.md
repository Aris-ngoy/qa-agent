# yoqa-sim live stream in the Inspector (`device-sim`)

## Goal

Ticket [#241](https://github.com/Aris-ngoy/qa-agent/issues/241) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-sim`](../plans/device-lanes/device-sim.md)). `yoqa-sim` prints `stream_ready http://127.0.0.1:<port>/stream.mjpeg` and serves MJPEG from its frame store. The opted-in iOS-simulator Direct lane reports that feed as the session's live stream. The Inspector then shows it through the existing `GET /stream.mjpeg` proxy. The agent never reads the stream.

## Plan summary

- **Same port as the control API.** `GET /stream.mjpeg` on `yoqa-sim`'s loopback server. `stream_ready` is printed right after `api_ready`.
- **One JPEG part per new frame.**
  - Each connection waits on the frame store for the next frame (`FrameStore.waitForFrame`), capped at 30 fps.
  - An idle screen sends nothing new. Its frame is sent again every second as a heartbeat, so a client that left is noticed.
  - A write blocked for 5 s (`SO_SNDTIMEO`) drops that client.
  - When the display loses its framebuffer, the stream ends. With no frame at all, the route is a 503.
- **Half scale by default** (`?scale=` overrides). The quarter-scale preview looked soft in the Inspector's mirror on a Retina screen. Appium's broadcaster runs at 50% too. The quarter-scale `/screenshot` default is unchanged.
- **Spawned at connect, not on first use.**
  - The Inspector picks Stream or Poll once, from the connect response (`streamReady`). So the session has to know about `stream_ready` before connect returns.
  - When `device-sim` is opted in, the lane now awaits `yoqa-sim` at connect: about 370 ms on an iPhone 17 Pro simulator. Start-up is still paid once per session.
  - Worst case, a `yoqa-sim` that hangs before `api_ready` holds connect for its 10 s ready timeout, plus 500 ms for `stream_ready`, before the lane falls back to idb_companion. That applies to every opted-in session, with or without an Inspector.
  - `yoqa-ax` stays lazy (first screen or action).
  - Rejected: keeping the spawn lazy and having the Inspector switch from Poll to Stream when a later status says `streamReady`. That needs Inspector changes and starts every session on Poll.
- **No stream means Poll.**
  - The session's `stream` is null when `yoqa-sim` printed no `stream_ready` within 500 ms of `api_ready`, failed to start, or later became unreachable.
  - It is also null after quit.
  - The Inspector already polls screenshots when `streamReady` is false.
- **The stream proxy route doesn't change.** It fetches `stream.upstreamUrl` as it does for Appium.

## What shipped

- `native/yoqa-sim/`
  - `Response.stream`: a body written in parts after the head, without `Content-Length`. `LoopbackServer` runs it until a write fails.
  - `FrameStore.waitForFrame(after:timeout:)`: the store's lock is now an `NSCondition`, signalled when a frame arrives.
  - `Controller`: `GET /stream.mjpeg` (`multipart/x-mixed-replace; boundary=yoqa-frame`), with `streamHeartbeat`.
  - `main.swift` prints `stream_ready`.
  - Tests: one part per new frame until the client leaves, the heartbeat resend, a 503 with no framebuffer, streamed serialization, and the `stream_ready` line from the real binary.
- `services/runner/src/domains/devices/`
  - `yoqa-sim.ts`: `YoqaSim.streamUrl`, read from `stream_ready` (`streamReadyTimeoutMs`, 500 ms by default). The ready timeout covers `api_ready` only.
  - `ios-direct-lane.ts`: spawns `yoqa-sim` at connect and sets `session.stream`. The stream is cleared on fallback and on quit.
  - Tests: the client parses or misses `stream_ready`, the lane reports the stream or none, and a crash takes the stream away. The Lane contract harness's fake has a stream.

## How to verify

1. `cd native/yoqa-sim && xcrun swift test` (boot a simulator to run the live process test).
2. `bun test ./services/runner/src/domains/devices/{yoqa-sim,ios-yoqa-sim-lane,lane-contract}.test.ts`
3. Live, with idb_companion installed:
   - `xcrun swift build -c release`.
   - Start the runner with `YOQA_DIRECT_IOS_SIMULATOR=device-sim` and connect a booted simulator in the Inspector.
   - The badge shows **Stream**, and the mirror follows the simulator.
   - `curl -N http://127.0.0.1:7420/stream.mjpeg | head -c 200` shows `--yoqa-frame` parts.
4. Without idb_companion (as on the build machine here), the connect falls back to Appium before it reaches `yoqa-sim`. The lane was checked with idb `describe` stubbed and the real binary:
   - connect took 368 ms and reported `upstreamUrl: http://127.0.0.1:<port>/stream.mjpeg`;
   - the upstream answered `200 multipart/x-mixed-replace; boundary=yoqa-frame`;
   - quit cleared the stream and killed `yoqa-sim`.

## Follow-ups

- `device-sim` still needs idb_companion for `describe`, typing and lifecycle, so it can't open without it. Promotion (#245) needs the benchmark on a machine that has it installed.
- The Inspector doesn't fall back from Stream to Poll mid-session when the stream dies (an existing follow-up in [manual-inspector-mjpeg-stream.md](../desktop/manual-inspector-mjpeg-stream.md)). `session.stream` is cleared only when the next frame read or action finds `yoqa-sim` unreachable, not when the process exits.
