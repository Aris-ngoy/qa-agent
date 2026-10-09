# device-sim

Resident macOS binary. One process per booted simulator. Owns the framebuffer and HID. The iOS-simulator Direct implementation for input and screenshots, ahead of idb_companion, which stays as the fallback.

Start after the Android Direct implementation exists. Can run in parallel with `device-ios`.

Spawn from the runner on the first `screen` or `action` for that UDID. Keep it for the session. Kill it on disconnect.

```text
yoqa-sim ios --id <udid> [--device-set <path>]
```

Stdout, one line each, then silence:

```text
api_ready http://127.0.0.1:<port>
stream_ready http://127.0.0.1:<port>/stream.mjpeg
```

Bind `127.0.0.1` only. The runner parses those two lines and stores them on the session.

## First slice

A process the runner can spawn that prints `api_ready` and stays up. Resolve `SimulatorKit` from `xcode-select -p` in this slice. Xcode 27 moved it from `Developer/Library/PrivateFrameworks` to `Contents/SharedFrameworks`. A hardcoded path wastes the week.

## Second slice

`GET /screenshot` from `xcrun simctl io screenshot`, even though it is slow, so the route is real. Scale to 0.25 in the runner.

## Third slice

The real server.

- Link `CoreSimulator` and `SimulatorKit`. idb's `FBSimulatorControl` is the open reference for the IOSurface and HID calls. Write your own binary. Do not ship theirs, and do not open Argent's `simulator-server`.
- Capture thread copies the simulator IOSurface into a quarter-scale JPEG ring buffer. `/screenshot` returns the latest frame. Age is one frame.
- HID thread writes Down and Up. Default hold is 16 ms. Zero-length taps get dropped by `UIControl`. Do not wait for the app after Up.
- Boot, install, launch, terminate stay `xcrun simctl` in the runner. This process does not own lifecycle.

Control API:

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| POST | `/tap` | `x`, `y` in 0.0–1.0, optional `holdMs` default 16 | Down, hold, Up |
| POST | `/swipe` | `fromX`, `fromY`, `toX`, `toY`, `durationMs` default 200 | Down, moves, Up |
| POST | `/key` | `key` | `home` only: a swipe up from the bottom edge. Button messages aren't handled by current runtimes ([#240](../../devices/yoqa-sim-framebuffer-hid.md)) |
| GET | `/screenshot` | `scale` default 0.25, `format` `jpeg` (default) or `png` | Latest frame, not a fresh capture; `X-Frame-Hash` identifies its pixels. The Lane reads `scale=1&format=png` |
| GET | `/display` | | Width, height, scale, orientation |
| POST | `/shutdown` | | Exit |

MJPEG is last. The agent never reads the stream. The desktop preview does.

## Done

A warm `/tap` returns in under 30 ms and `/screenshot` returns in under 5 ms on a booted iPhone simulator, measured at the socket.

## Out of scope

Physical devices, accessibility, dylib injection, Android.
