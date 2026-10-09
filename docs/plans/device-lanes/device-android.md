# device-android

Instrumentation APK plus adb. A faster Android Direct implementation; UiAutomator2 stays on the Appium lane. No framebuffer server. adb is fast enough, and this package is the tracer bullet for a new Direct implementation behind the Lane seam.

The runner stays on `127.0.0.1:7420`. This package does not add routes. It implements the Device Session methods the runner already calls, as the `device-android` implementation of the Android Direct lane.

## First slice

One serial. Nothing else.

- `adb exec-out screencap -p` on a background thread. `GET /screenshot` returns the latest frame, scaled to 0.25 in the runner.
- `adb shell input tap` for `POST /action` with `kind: "tap"`. Coordinates arrive as 0–1000 and convert to pixels here, at the Lane's edge.
- Launch and stop stay raw `adb` (`am start`, `am force-stop`) in the runner.

Do not start with the APK. `uiautomator dump` is good enough for the tree until a tap returns the latest frame.

Done when a warm tap plus latest frame on an emulator is under 100 ms, measured at the runner.

## Second slice

Test-only APK, package `yoqa.android.devtools`.

- Install with `adb install -r -t`.
- Drive with `am instrument`.
- Dump the foreground window as JSON on stdout: `role`, `label`, `value`, `id`, `bounds` in 0.0–1.0, `enabled`.
- One `adb forward` per serial. Remove it on disconnect.
- `uiautomator dump` remains the fallback, not the session.

Done when the tree call is under 150 ms.

## Verbs

| Verb | Command |
| --- | --- |
| screenshot | `adb exec-out screencap -p`, scale in the runner |
| tap, swipe, key, text | `adb shell input` |
| tree | instrumentation, else `uiautomator dump` |
| launch, stop | `am start`, `am force-stop` |
| install | `adb install -r` |
| permissions | `pm grant` / `pm revoke` where the API allows |

A tap does not wait for the capture thread.

## Out of scope

Custom HID server, injection, Wear, removing Appium.

## Seam

The Lane only. HTTP edge stays 0–1000. `POST /action` with `kind: "tap"` keeps its schema and returns the Result screenshot after the existing Settle when `screenshot: true` is set. The tree is not added to the Action response. Changing Settle to "two identical frame hashes or 200 ms" is a separate, benchmark-gated change.
