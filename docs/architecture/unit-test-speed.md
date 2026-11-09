# Unit test speed

## Goal

Cut the wall-clock time of `bun run test` (the **Unit tests** required check). The suite ran in about 63s
locally at roughly 35% CPU: most of it was waiting on real timers, not doing work.

## Plan summary

Timed every test with `bun test --reporter=junit` and ranked files and tests. Five runner files held
about 47s of the 61s. Three of them waited for reasons a test-side change removes, so those are fixed
here. Rejected for now: running files concurrently or sharding CI. `services/runner` is most of the
suite, and its tests share module mocks and globals, so removing the waits pays more and costs less.

## What shipped

- **Android background-capture lanes** (`lane-harnesses.ts`): the faked adb answers at once, so the
  frame loop (`frame-loop.ts`) never yields while it runs and held the event loop for its default 2s
  idle after every read. The harness now uses a 50ms idle. `lane-contract.test.ts`: 13.2s → 1.7s.
- **Runs through the Run service** (`runs/application.ts`): `setCaseSettleMsForTests` passes a
  `settleMs` to the case executor, which otherwise sleeps the real 800ms `POST_ACTION_SETTLE_MS` after
  each Action. `web-run.test.ts` sets it to 0. 11.3s → about 2s.
- **yoqa-sim lane** (`ios-yoqa-sim-lane.test.ts`): "a tap never waits…" faked a 2s tree read and a 2s
  connect, then waited for them. 1s still sits well clear of the 500ms bound the tests assert.

Full suite: 63.0s → 38.0s locally.

## How to verify

```bash
bun run test
```

To rank the slowest tests yourself, run with `--reporter=junit --reporter-outfile=junit.xml` and sort
the `testcase` elements by `time`.

## Follow-ups

- `web-direct-lane.test.ts` (~9.6s): the screen-changed tests take 0.6–2.2s each against the fake CDP
  server, so a real settle or poll timer is running in the lane.
- `ios-device-lane.test.ts` (~8.5s): "a cable miss…" takes 3.6s even with `unreachableGraceMs: 0`.
- Other Run-service tests (`catalog/*`, `run-video-delete.test.ts`) could set
  `setCaseSettleMsForTests(0)` too if they grow slow.
