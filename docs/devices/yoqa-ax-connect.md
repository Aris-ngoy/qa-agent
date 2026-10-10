# yoqa-ax connects back (`device-ax`)

## Goal

Ticket [#242](https://github.com/Aris-ngoy/qa-agent/issues/242) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ax`](../plans/device-lanes/device-ax.md) first slice). This slice gives the opted-in iOS-simulator Direct lane a helper of our own, `yoqa-ax`, running inside the simulator:

- The runner binds a Unix socket, then spawns the helper with `xcrun simctl spawn <udid> yoqa-ax --connect <socket>`.
- The helper connects back and answers `ping` over length-prefixed JSON, one request in flight.
- A helper that doesn't connect within 10 s leaves the session working, marked degraded.

The tree (`describe`, #243) and alerts (#244) come in later slices.

## Plan summary

- **The guest is a plain iOS-simulator executable.** It is a SwiftPM package built with `--triple <arch>-apple-ios17.0-simulator`. `simctl spawn` runs it as a process of the simulator, and that process reaches the host's `/tmp` socket directly. The core also builds for macOS, so its tests and the binary's wire-protocol tests run on the host without a simulator.
- **Wire format.** Each frame is a 4-byte big-endian length, then a UTF-8 JSON body (16 MB limit).
  - Request: `{"id":1,"method":"ping"}`.
  - Reply: `{"id":1,"result":"ok"}`, or `{"id":1,"error":"…"}` (for example `unknown method describe`).
  - The runner sends one request at a time. A reply that arrives after its request timed out (5 s) is dropped by id.
- **Socket path.** It is `/tmp/yoqa-ax-<udid8>-<random>.sock`. Unix socket paths are limited to 104 bytes, which rules out `$TMPDIR`. The random suffix is a deviation from the plan, so two runners never take each other's socket. The listener stops accepting after the first connection.
- **Started on first use, never waited on.** The first screen, tree read or action starts `yoqa-ax` in the background, next to `yoqa-sim`. Nothing waits for it, so a slow helper never delays a tap.
- **Degraded, not failed.** The helper might not connect within 10 s, might exit first, or might not be built. In all three cases the session reports a Lane warning: `Session degraded: yoqa-ax is unavailable, so the tree stays on idb_companion (…)`. The warning goes through `reportLaneFallback`, so it reaches the Run report the way other mid-session fallbacks do. The session keeps working, and the tree stays on idb_companion. No separate "degraded" field was added, since nothing would read it yet.
- **Lifeline and cleanup.** The guest exits when its socket closes. Quit closes the connection and removes the socket file. It waits up to 2 s for `simctl spawn` to exit, then sends SIGKILL. A helper that never connected gets SIGTERM, which `simctl spawn` passes to the guest.
- **`AutomationEnabled` is never set.** Nothing in the spawn sets it (it hangs the query on current simulators).
- Rejected:
  - TCP on loopback (the plan wants it only for a remote simulator);
  - spawning at connect (the plan says first use, as for `yoqa-sim`);
  - failing the `device-sim` start when `yoqa-ax` isn't built (the tree has a fallback, input and frames don't need it).

## What shipped

- `native/yoqa-ax/`: a SwiftPM package with no dependencies.
  - `YoqaAxCore`:
    - `Arguments` (`--connect <socket>`);
    - `Framing` and `FrameReader`;
    - `Handler` (`ping`; anything else is an error reply);
    - `UnixSocket` (connect, then a serve loop that ignores SIGPIPE).
  - `yoqa-ax`: the executable.
  - Tests (10):
    - arguments;
    - framing across chunk boundaries and the size limit;
    - replies;
    - the host-built binary at its wire protocol: it connects back, answers `ping`, exits when the socket closes, and exits non-zero when nobody listens.
- `services/runner/src/domains/devices/`
  - `yoqa-ax.ts`:
    - `startYoqaAx` binds, spawns, waits for the connection (10 s), confirms with one `ping`, and has an idempotent `stop`;
    - `resolveYoqaAxBin` reads `YOQA_AX_BIN`, else `native/yoqa-ax/.build/out/Products/{Release,Debug}-iphonesimulator/yoqa-ax`.
  - `ios-direct-lane.ts`: `IosDirectDeps.yoqaAx`, started on first use, with the degraded warning, and stopped on quit (also while it is still connecting).
  - `direct-lane.ts`: `device-sim` passes `yoqaAx`. If the binary isn't built, the session runs degraded with that reason.
  - Tests:
    - `yoqa-ax.test.ts` (4): a fake helper that connects to the real socket. It covers `ping`, the connect timeout, an early exit and `stop`.
    - `ios-yoqa-sim-lane.test.ts` (+4): start once on first use, quit while connecting, taps don't wait, and a helper that never connects leaves the session usable and degraded.

## Measurements

iPhone 17 Pro simulator (iOS 26.5), Xcode 27, Apple silicon, release build:

- Spawn to connected and first `ping`: 380–420 ms.
- Warm `ping`: about 0.1 ms. The first `ping` over Python took 5.5 ms.
- `stop`: 6 ms. The guest and `simctl spawn` are gone after it, and so is the socket file.
- Through the Lane, with idb stubbed (idb_companion isn't installed here):
  - With the real `yoqa-ax`: no Lane warning, and no process left after quit.
  - With a simulator binary that never connects: the degraded warning came at 10 s, frames and taps kept working, and the hung guest was gone after quit.

## How to verify

1. `cd native/yoqa-ax && xcrun swift test`
2. Build for the simulator. Run `xcrun swift build` itself, not `xcrun --sdk iphonesimulator swift build`, which breaks the manifest build:
   ```bash
   cd native/yoqa-ax && xcrun swift build -c release --triple "$(uname -m)-apple-ios17.0-simulator" --sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)"
   ```
3. `bun test ./services/runner/src/domains/devices/{yoqa-ax,ios-yoqa-sim-lane}.test.ts`
4. Live:
   - Start the runner with `YOQA_DIRECT_IOS_SIMULATOR=device-sim` (idb_companion installed) and connect a booted simulator on the Direct lane.
   - After the first screen, `pgrep -fl "yoqa-ax --connect"` shows the guest, and the session has no Lane warning.
   - After disconnect, the guest and `/tmp/yoqa-ax-*.sock` are gone.

## Follow-ups

- #243: `describe` from `yoqa-ax`, cached by `yoqa-sim`'s frame hash ([yoqa-ax-describe.md](./yoqa-ax-describe.md)). #244: `alert`.
- A guest that disconnects mid-session: its next `describe` fails, and the tree moves to idb_companion for the rest of the session (#243).
- Ship the binary with the runner (build it in release CI, for both simulator architectures).
