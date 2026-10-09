# Yoqa device plans

Faster **Direct lane** implementations, one package per device class, behind the existing Device Session seam (spec: [#233](https://github.com/Aris-ngoy/qa-agent/issues/233)). The runner on `127.0.0.1:7420` does not change. The Lane (`LaneFactory → DeviceSession`, `services/runner/src/domains/devices/lane.ts`) is the only seam. Each package is one Direct implementation that the Direct lane picks internally (`direct-lane.ts`): opted in with `YOQA_DIRECT_<CLASS>` until it clears the benchmark gate, falling back once, loudly, to the existing Direct implementation and then to Appium. Every implementation passes the Lane contract suite (`lane-contract.test.ts`).

Order:

1. [`device-android`](./device-android.md) — tracer bullet. adb screenshot and tap.
2. [`device-ios`](./device-ios.md) — after the Android Direct implementation exists. Status across the cable before any gesture.
3. [`device-sim`](./device-sim.md) — after the Android Direct implementation exists. Can run in parallel with device-ios.
4. [`device-ax`](./device-ax.md) — after device-sim has a frame hash.

Appium is not removed ([ADR-0004](../../adr/0004-device-session-lanes.md)). It stays the capability-pinned Lane: a Case or App with custom Appium capabilities always runs on it. Removing it would need a new ADR that supersedes ADR-0004. Coordinates stay 0–1000 across HTTP and the Device Session interface; each Lane converts once, at its own outer edge.

Skill sequence, one fresh session each: `/setup-matt-pocock-skills`, `/grill-with-docs`, `/to-spec`, `/to-tickets`, then `/implement` per ticket.
