# iOS simulator: `device-sim` becomes the Direct default

## Goal

Ticket [#245](https://github.com/Aris-ngoy/qa-agent/issues/245) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233)). Benchmark the new iOS-simulator Direct implementation (`device-sim`: frames and input from `yoqa-sim`, the Screen and alerts from `yoqa-ax`) against the idb_companion Direct implementation on the same simulator. Promote it only with a measured gain ([ADR-0004](../adr/0004-device-session-lanes.md) gate), with idb_companion kept as its fallback.

## Plan summary

- **Measure with the existing harness.** `yoqa benchmark --lane direct`, one runner at a time, three interleaved pairs (`idb`, then `device-sim`), 20 tap-to-result Actions per arm, `vision` and `tree` arms. Warm Screen and frame reads were timed separately over HTTP, because the harness takes one Screen read per run.
- **A fair target.** The tap is on the inert "Settings" large title on the Settings root (`x 200, y 160`, expected label `Settings`). Settings was relaunched to its root before the series and was still there after it.
- Two targets were rejected while measuring:
  - The status bar (`x 500, y 12`). On the iPhone 17 Pro it sits on the Dynamic Island. `yoqa-sim`'s HID touch is a real digitizer touch, so the island animates for about 1.5 s and Settle runs to its cap. idb's tap doesn't trigger that. A real finger would, so this is not a `yoqa-sim` defect, just a bad benchmark target.
  - No named target. idb's tree has full-screen containers (one is labelled with the app's name), so every tap "hits" on idb whatever it lands on. yoqa-ax returns only real elements. With a named target, both are scored the same way.
- **Promote by flipping `promoted`.** `device-sim` gets `promoted: true` in `DIRECT_IMPLEMENTATIONS["ios-simulator"]`, ahead of `idb`. No other selection code changes ([device-lanes-foundation.md](./device-lanes-foundation.md)).

## What the benchmark found first

The first series was wrong, and the cause was a bug in the existing idb implementation:

- **idb vision taps landed 3× off.** In `screenshot` coordinate space, which every coordinate Action uses (`interaction.ts`), the idb path converted 0–1000 to screenshot *pixels* (1206×2622) and passed them to `idb ui tap`, which takes *points* (402×874). A tap on the title (80, 140 pt) went to (241, 420 pt), the Action Button row, so Settings kept opening that animated page. This dates from the first idb Direct lane. The old benchmark scored taps as hits anyway, because of the full-screen containers above. Inspector pointer events had the same bug.
- **The Lane contract fakes hid it.** Every harness served screenshots at the same size as the device's input units. iOS harnesses now serve 3× screenshots, as on the iPhone 17 Pro. A new contract test taps the corners in `screenshot` space for every Lane.
- **A failed `yoqa-sim` start threw away the whole `device-sim` session.** `openDeviceSession` handles a Lane warning by writing to the session it hands out. That session didn't exist yet while the Lane opened. So a fallback reported during open (yoqa-sim failing at connect) threw "Cannot access 'session' before initialization". The open then failed and dropped to plain idb, losing yoqa-ax and the real reason. A warning reported during open is now carried by the Lane's own `laneWarning`, as it already was. Only a later one is copied onto the session. This matters now that every iOS-simulator connect tries `device-sim` first.

## Measurements

iPhone 17 Pro simulator (iOS 26.5), Xcode 27, Apple silicon, idb_companion v1.6.5, release builds of `yoqa-sim` and `yoqa-ax`. Raw JSON: [`benchmark-ios-sim-promotion.json`](./benchmark-ios-sim-promotion.json).

Tap-to-result: `POST /action` tap with `screenshot: true` (Settle), then the Screen read the harness uses to score the tap. p50 / p95 in ms, 20 taps per arm.

| Pair | `idb` vision | `device-sim` vision | `idb` tree | `device-sim` tree |
| --- | --- | --- | --- | --- |
| 1 | 1247 / 1342 | 333 / 343 | 1236 / 1324 | 328 / 342 |
| 2 | 1228 / 1276 | 332 / 347 | 1168 / 1210 | 323 / 349 |
| 3 | 1157 / 1186 | 329 / 352 | 1194 / 1250 | 329 / 360 |

- Phases (means): the tap is 233–252 ms on idb and 20 ms on `device-sim`, and Settle is 435–482 ms and 165 ms.
- Tap accuracy was 1.00 on every run of both implementations.

Warm reads over HTTP at the runner (20 each, p50 / p95 ms, two runs each):

| Read | `idb` | `device-sim` |
| --- | --- | --- |
| `GET /screen`, frame unchanged | 362–368 / 375–378 | 1 / 1–2 |
| `GET /screen` after an inert tap | 386–407 / 412–422 | 2–3 / 5 |
| `GET /screenshot/image` | 172–177 / 183–226 | 1–2 / 3–4 |
| First `GET /screen` after connect | 336–339 | 490–514 |

- **Tap-to-result is about 3.6× faster** (p50 ~330 ms against ~1.2 s), repeatably, with p95 within 30 ms of p50.
- **The only slower number is the first Screen read after connect** (~150 ms more). That read waits for `yoqa-ax` to spawn and connect back. Every later read is cached by frame hash, or a fresh yoqa-ax read (35–80 ms on a new frame, [yoqa-ax-describe.md](./yoqa-ax-describe.md)).
- The connect itself (`coldStart`) is 380–490 ms on `device-sim` against 150–700 ms on idb, because `yoqa-sim` spawns at connect.
- **Case pass rate was not measured.** The suite has no Cases yet ([benchmark.md](./benchmark.md) follow-up), so the harness had none to replay.

**Decision: promoted, with case pass rate unmeasured.** The latency gain is large and holds in every pair, and accuracy is unchanged. That meets ADR-0004's "measured gain" rule. Case pass rate joins the gate when the suite has Cases.

## What shipped

- `direct-lane.ts`: `device-sim` is `promoted`, so `auto` and `direct` on an iOS simulator try it first. A failed start falls back to `idb`, then to Appium, with a Lane warning at each step. `YOQA_DIRECT_IOS_SIMULATOR=idb` rolls back to idb_companion alone.
- `ios-direct-lane.ts`: the idb fallback converts taps, swipes and pointer events with the window size in points, in both coordinate spaces.
- `open-session.ts`: a Lane warning reported while the Lane opens no longer fails the open.
- Tests:
  - `lane-harnesses.ts` serves iOS screenshots at 3×, and each harness exposes the frame it serves.
  - `lane-contract.test.ts`: corner taps in `screenshot` space, for every Lane.
  - `session-registry.test.ts`: a fallback reported during open keeps the Lane and shows once.
  - `select-lane.test.ts` pins the new default order and the rollback.
- Benchmark results: [`benchmark-ios-sim-promotion.json`](./benchmark-ios-sim-promotion.json). Glossary **Lane** entry updated in [`CONTEXT.md`](../../CONTEXT.md).

## How to verify

1. `bun test services/runner/src/domains/devices/{lane-contract,select-lane,session-registry,ios-direct-lane,ios-yoqa-sim-lane}.test.ts`
2. `bun run check`, `bun run lint:ci`, `bun run test`.
3. Live, with idb_companion and the fb-idb client installed ([ios-direct-lane.md](./ios-direct-lane.md)), and `yoqa-sim` and `yoqa-ax` built ([yoqa-sim-spawn.md](./yoqa-sim-spawn.md), [yoqa-ax-connect.md](./yoqa-ax-connect.md)):
   - With no env var, connect a booted simulator. The Screen comes from yoqa-ax (no full-screen containers), and a warm `GET /screen` takes about 1 ms.
   - Start the runner with `YOQA_SIM_BIN=/nonexistent`. Connect still lands on `direct`, with the laneWarning `yoqa-sim failed; using idb_companion …` and the ENOENT reason, and taps hit their target.
   - Start it with `YOQA_DIRECT_IOS_SIMULATOR=idb`. The session is plain idb_companion.
   - Rerun the benchmark: launch Settings to its root, then `yoqa benchmark --device <udid> --platform ios --lane direct --suite <suite with the tap above>`.

## Follow-ups

- **Ship `yoqa-sim` and `yoqa-ax` with the runner.** Until they ship, a machine without local builds tries `device-sim` on every connect, falls back to idb at once ("not built"), and records that Lane warning each time.
- The fallback is logged twice: once when the Lane reports it, once in the connect summary. Same for every fallback, not new here.
- Check other SpringBoard dialogs (notifications, tracking, "Open in …") with `yoqa-ax` alerts. Only Maps' location prompt was checked live ([yoqa-ax-alerts.md](./yoqa-ax-alerts.md)).
- Add Cases to the benchmark suite, so case pass rate is part of the gate.
- Rerun on an iOS 27 simulator and on a 2× device.
