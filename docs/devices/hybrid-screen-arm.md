# Benchmark arm: screenshot + tree every step

## Goal

Expose a Run option and a harness arm that send the screenshot **and** the Screen tree on every Agent step, compare it to vision-first, and flip the default only if hybrid wins. Ticket [#191](https://github.com/Aris-ngoy/qa-agent/issues/191). Vocabulary: **Screen**, **Screen mode** in [`CONTEXT.md`](../../CONTEXT.md). ADR-0004 already says this arm is not the default.

## Plan summary

- The Run option already exists: `yoqa runs create … --screen-mode tree` (API `screenMode: "tree"`). The report names it (`Screen | tree`).
- The harness grows `--arms vision,tree`. Each arm is a labeled Yoqa row (`yoqa/vision`, `yoqa/tree`). Catalog Cases (suite `cases` + `--app`) replay as Agent runs in that Screen mode and record pass rate and step count.
- `recommendScreenDefault` flips to tree only when that arm has a higher Case pass rate and does not lose tap accuracy. No Case samples → keep vision.

## What shipped

- Suite `arms` (`vision` | `tree`). Default suite stays `["vision"]`.
- `yoqa benchmark --arms vision,tree [--app <catalog-id>] [--lane direct]`
- Report recommendation line / JSON `recommendation`
- Default stays **vision**. There is no hardware comparison yet that would justify a flip.

## How to verify

1. `bun test services/runner/src/domains/benchmark`
2. `yoqa runs create APP --cases 1 --mode agent --screen-mode tree --wait` — report `Screen | tree`.
3. On a device: `yoqa benchmark --device <id> --platform android --lane direct --arms vision,tree --app DEMO` (needs suite `cases`). Prints `default vision — …` until Cases exist and tree wins.

## Follow-ups

- Record a live Direct-lane comparison (pass rate, tap accuracy, step count) over the fixture once a catalog App is in the suite.
- [#188](https://github.com/Aris-ngoy/qa-agent/issues/188) idb spike still needs a simulator.
