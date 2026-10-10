# Physical iOS: the Direct lane over usbmuxd

## Goal

Ticket [#248](https://github.com/Aris-ngoy/qa-agent/issues/248) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ios`](../plans/device-lanes/device-ios.md), third slice). An explicit `direct` request on a cabled iPhone opens a Direct session. The Mac reaches `YoqaRunner` ([yoqa-runner-status.md](./yoqa-runner-status.md)) through `/var/run/usbmuxd`, and a `status` call must cross the cable before the session is handed out. `auto` on a physical iPhone still picks Appium.

## Plan summary

- **A device class, not a new Lane.** A physical iPhone is the `ios-device` device class, told apart by its UDID (`looksLikePhysicalIosUdid`). Its one Direct implementation is `device-ios`. The Lane is still `direct`, so the Run report says `direct`. `YOQA_DIRECT_IOS_DEVICE` is its opt-in variable, like the other classes.
- **`auto` is gated per device class, before any Direct start.** `directIsAutomatic("ios-device")` is false, and `selectLane` then answers Appium for `auto` with no warning. Before, `auto` on a phone tried the Direct lane, which the simulator implementations rejected, and Appium opened with a "fell back" warning. Gating it up front also matters now that Direct would build and start a runner on the phone. The Lane stays Appium either way. #251 flips the gate once `device-ios` beats Appium in the benchmark.
  - Rejected: leaving `device-ios` unpromoted inside the Direct lane. With no promoted implementation, an explicit `direct` would need an env var as well to reach it.
- **usbmuxd, as planned.** `usbmuxd.ts` speaks its protocol: 16-byte little-endian headers around XML plists. `ListDevices` maps the UDID to a DeviceID. A phone usbmuxd only lists as `Network` is refused ("not on a USB cable"). `Connect` sends the port in network byte order, and the socket then becomes a raw tunnel to the phone's loopback. UDIDs are compared without case or dashes. #247 saw an empty `ListDevices` on this Mac. With the phone on a cable on 2026-10-10, usbmuxd listed it as `USB`, so the CoreDevice tunnel isn't needed.
- **The tunnel is handed over paused.** `connectUsbmux` pauses the socket while it reads usbmuxd's reply, so bytes that belong to the phone aren't lost. The link resumes it once it is listening. A paused Node stream does not resume when a `data` listener is added, so this has to be explicit.
- **One tunnel per command.** `YoqaRunner` answers with `Connection: close`, so `yoqa-runner-link.ts` opens a new usbmuxd tunnel for every command. It sends one `POST /` with `{ command, commandId, ... }`, reads up to `Content-Length`, and unwraps the `{ ok, data | error }` envelope. A runner error is a `YoqaRunnerCommandError` with the runner's `code`. A tunnel that won't open, a timeout (10 s), or a reply that isn't the envelope is a `YoqaRunnerUnreachableError`.
- **The session.** `createIosDeviceSession` starts the runner (`startYoqaRunner`, cached build), then sends `status` through the tunnel. If that fails, it stops the runner and throws, and `openDeviceSession` falls back to Appium with a Lane warning that carries the reason. A runner that exits on its own fires `onSessionDead`. `quit` stops it once. `activateApp` is `xcrun devicectl device process launch`. Gestures, frames, the tree and the rest reject with "… is not available on the physical-iOS Direct lane yet". #249 and #250 fill them in.

## What shipped

- `services/runner/src/domains/devices/usbmuxd.ts`: `listUsbmuxDevices` and `connectUsbmux`, with `UsbmuxError`.
- `services/runner/src/domains/devices/yoqa-runner-link.ts`: `createYoqaRunnerLink(openTunnel)`.
- `services/runner/src/domains/devices/ios-device-lane.ts`: `createIosDeviceSession` and `iosDeviceDeps()`.
- `select-lane.ts`: the `ios-device` class, `directIsAutomatic` and `YOQA_DIRECT_IOS_DEVICE`. `selectLane` takes `directIsAutomatic`.
- `direct-lane.ts`: `deviceClassFor(platform, deviceId)`, the `device-ios` entry, and a default Direct lane that picks the class from the device it opens.
- `open-session.ts`: passes the device class's `directIsAutomatic` to `selectLane`.
- Tests:
  - `usbmuxd.test.ts` (6): a fake usbmuxd on a Unix socket that speaks the real framing.
  - `yoqa-runner-link.test.ts` (6): a real HTTP server standing in for the runner.
  - `ios-device-lane.test.ts` (8): runner start and tunnel faked.
  - `select-lane.test.ts` (+3) and `session-registry.test.ts` (+3): `auto`, explicit `direct`, and the `status` fallback on a phone.
- `CONTEXT.md` (Lane): physical iOS stays Appium under `auto` and reaches `device-ios` through `direct`.

## How to verify

1. `bun test services/runner/src/domains/devices/usbmuxd.test.ts services/runner/src/domains/devices/yoqa-runner-link.test.ts services/runner/src/domains/devices/ios-device-lane.test.ts services/runner/src/domains/devices/select-lane.test.ts services/runner/src/domains/devices/session-registry.test.ts`
2. With a phone on a cable, unlocked, Developer Mode on (iPhone 15, iOS 27.0.1, 2026-10-10):

   ```ts
   import { defaultLanesFor, openDeviceSession } from "./services/runner/src/domains/devices/open-session";
   const s = await openDeviceSession(
   	{ platform: "ios", deviceId: "<udid>", appCaps: [], caseCaps: [], requestedLane: "direct" },
   	{ direct: defaultLanesFor("ios").direct },
   );
   console.log(s.lane, s.laneWarning); // "direct", undefined
   await s.quit();
   ```

   | Request | Lane | Warning | Open time |
   | --- | --- | --- | --- |
   | `direct`, first (runner build already cached) | `direct` | none | 17.9 s |
   | `direct`, again | `direct` | none | 3.6 s, 2.9 s |
   | `direct`, with the tunnel never read (a bug caught during review) | `appium` | "Direct lane failed to start; fell back to Appium (YoqaRunner status did not cross the cable to port 49733: … within 10000 ms)" | 13.7 s |
   | `auto` | `appium` | none | runner not started |

   When you inject lanes into `openDeviceSession`, pass `direct` explicitly. Any injected lane replaces the defaults, so `{ appium }` alone has no Direct lane, and `direct` falls back with "Direct lane is not available".

## Follow-ups

- #249 (tap, long-press, drag, screenshot, the journal, the Lane contract suite) and #250 (snapshot, typing, `APP_BACKGROUNDED`, `RUNNER_WEDGED`).
- `terminateApp`, `openUrl` and `backgroundApp` on `devicectl` aren't in any ticket yet. They need a process lookup (`devicectl device info processes`) to find the pid.
- **Active Session adoption restarts the runner.** Before adopting, `acquireSessionForRun` health-checks with `getWindowSize`, which this slice rejects. So a Direct Active Session on a phone counts as dead, and the Run opens a fresh Direct session with a misleading "is dead" log. The Run still gets `direct`. #249's `viewport` command makes `getWindowSize` real and fixes this (done, see [ios-device-actions.md](./ios-device-actions.md)).
- **Older iPhones' 40-hex UDIDs.** `looksLikePhysicalIosUdid` accepts only the `8-16` hex form, so an older phone is classified `ios-simulator`. `direct` then fails into Appium with a simulator-lane warning instead of reaching `device-ios`.
- The action lock is a third copy of the `createLock` chain in the Android and iOS-simulator lanes.
