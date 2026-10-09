# yoqa-sim spawns and serves screenshots (`device-sim`)

## Goal

Ticket [#239](https://github.com/Aris-ngoy/qa-agent/issues/239) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-sim`](../plans/device-lanes/device-sim.md) first and second slices). The goal is a resident macOS binary of our own, `yoqa-sim`, for one booted iOS simulator:

- It finds SimulatorKit in the active Xcode, binds loopback only and announces `api_ready`.
- The iOS-simulator Direct lane, when opted in, spawns one per device on first use and kills it on quit.
- `GET /screenshot` works, backed by `simctl io screenshot` for now.

## Plan summary

- **A new Direct implementation, `device-sim`.** It is registered ahead of `idb` in `DIRECT_IMPLEMENTATIONS["ios-simulator"]`, without `promoted`. It runs only with `YOQA_DIRECT_IOS_SIMULATOR=device-sim`. Input, tree and lifecycle stay on idb_companion and `simctl` in this slice. Only frames come from `yoqa-sim`.
- **Spawn on first use.** The first frame read *or* action starts `yoqa-sim`. Actions start it without waiting for it, so input never waits on a spawn. Concurrent first reads share one spawn.
- **Fallback, loud, at every point.**
  - Binary not built at connect: `device-sim` fails to open, and the Direct lane falls back to `idb`, then Appium (#236).
  - Spawn fails, or a screenshot fails mid-session: the session stops `yoqa-sim` and uses idb_companion for the rest of the session, and adds the reason to its Lane warning.
  - A device that is really gone still surfaces as a Dead Session through idb.
- **Fallbacks after connect reach the Run report.** A Lane that falls back mid-session calls the new `SessionOptions.onLaneWarning`, through the shared `reportLaneFallback` helper. `openDeviceSession` adds the warning to the session it hands out, which the earlier code copied, so the warning was lost. A Run writes the session's latest Lane warning again when it finishes. This also fixes the Android helper's mid-session warning (#238).
- **Lifeline.** The runner keeps `yoqa-sim`'s stdin open. When the pipe closes (quit, or the runner crashing), `yoqa-sim` exits. Quit also sends SIGTERM, then SIGKILL after 2 s.
- **SimulatorKit.**
  - The path is resolved from `DEVELOPER_DIR` or `xcode-select -p`. `Contents/SharedFrameworks` (Xcode 27) is tried before `Contents/Developer/Library/PrivateFrameworks` (older Xcode).
  - Neither found: `yoqa-sim` exits non-zero before `api_ready`, which counts as a start failure.
  - It is located, not linked yet. Linking comes with the framebuffer slice (#240).
- **Swift, no dependencies.** It uses a POSIX loopback listener and one request per connection. The core (arguments, SimulatorKit resolution, routing) is a library target so tests reach it without a simulator.
- Rejected:
  - spawning at connect (the plan says first use). #241 later moved the spawn to connect, so the session can report its live stream ([yoqa-sim-stream.md](./yoqa-sim-stream.md));
  - the Network framework listener (it doesn't bind to loopback by default, and is harder to test);
  - copying idb's or Argent's servers (#233).

## What shipped

- `native/yoqa-sim/`: SwiftPM package. It ignores SIGPIPE (a runner that times out mid-response can't kill it), gives clients a 5 s request timeout, and backs off on `accept` errors. Build it with `xcrun swift build -c release`; the `swift` from swiftly is too old.
  - `yoqa-sim ios --id <udid> [--device-set <path>]`.
  - `GET /status` returns the UDID and the SimulatorKit path. `GET /screenshot` returns a full-size PNG from `simctl`, or 500 with the reason.
  - Tests (14):
    - arguments;
    - both Xcode layouts;
    - routing;
    - the binary at its wire protocol: the `api_ready` line on 127.0.0.1, `/status`, exit when stdin closes, bad arguments exit non-zero without `api_ready`.
- `services/runner/src/domains/devices/`
  - `yoqa-sim.ts`: `spawnYoqaSim` (spawn, `api_ready` parsing with a 10 s timeout, stderr in the start error, stop) and `resolveYoqaSimBin` (`YOQA_SIM_BIN`, else `native/yoqa-sim/.build/{release,debug}/yoqa-sim`).
  - `ios-direct-lane.ts`: `IosDirectDeps.yoqaSim`, with the lazy spawn, the fallbacks above, and the kill on quit.
  - `direct-lane.ts`: the `device-sim` entry.
  - Tests:
    - `ios-yoqa-sim-lane.test.ts`: the Lane seam, with yoqa-sim faked.
    - `yoqa-sim.test.ts`: the spawn seam. An injected process stands in for the binary and serves a real loopback server.
    - a `device-sim` harness in the Lane contract suite;
    - a registry pin in `select-lane.test.ts`.
- `lane.ts`: `onLaneWarning`, `reportLaneFallback`, `joinLaneWarnings`. `open-session.ts` wires them up. `runs/application.ts` stores the final warning.
- `biome.json` ignores `**/.build/**` (Swift build output).

## Measurements

iPhone 17 Pro simulator (iOS 26.5), Xcode 27, Apple silicon, runner code in-process:

- First read: about 1.1 s, which covers the spawn plus the first `simctl` capture. Two concurrent first reads started one `yoqa-sim`.
- Warm reads: 516–532 ms each, the cost of `simctl io screenshot`, as the plan expects for this slice.
- The PNG is 1206×2622.
- No `yoqa-sim` was left after quit, nor after `kill -9` of the runner process (stdin lifeline).

idb_companion isn't installed on the machine this was built on. So the live run stubbed idb's `describe` and used the real `yoqa-sim` for frames. A full `YOQA_DIRECT_IOS_SIMULATOR=device-sim` connect needs idb_companion until #240 moves input to `yoqa-sim`.

## How to verify

1. `cd native/yoqa-sim && xcrun swift test`
2. `bun test ./services/runner/src/domains/devices/{yoqa-sim,ios-yoqa-sim-lane,lane-contract,select-lane}.test.ts`
3. Live:
   - Boot a simulator and build with `xcrun swift build -c release`.
   - Start the runner with `YOQA_DIRECT_IOS_SIMULATOR=device-sim` (idb_companion installed), and connect on the Direct lane.
   - `pgrep -fl "yoqa-sim ios"` shows one process after the first screen, and none after disconnect.

## Follow-ups

- #240: framebuffer capture and HID input in `yoqa-sim` (the real server). #241: the MJPEG stream.
- Ship the binary with the runner (build and sign it in release CI).
- An in-flight `simctl` child can outlive a `yoqa-sim` killed with SIGTERM, for the second or so the capture takes. The framebuffer slice removes `simctl` from this path.
- Pass a non-default device set from the device list when one is known. `--device-set` is supported but the runner doesn't send it yet.
- `bun test <dir>` (filter mode, which `bun run test` uses) gives spawned processes a broken stdout on this machine (Bun 1.2.23), while `bun test ./file` doesn't. That is why `yoqa-sim.test.ts` injects the process, and it is what makes `ensureAdhocCodeSignature` fail locally.
