# Latency benchmark: Yoqa vs Argent

## Goal

A repo-local harness drives the same connector scenario through Yoqa (and Argent when that CLI is installed) and reports tap-to-result p50/p95, screen-read time, cold start, tap accuracy, and Case pass rate. Tickets [#181](https://github.com/Aris-ngoy/qa-agent/issues/181), [#182](https://github.com/Aris-ngoy/qa-agent/issues/182). Gate for later Direct-lane work ([ADR-0004](../adr/0004-device-session-lanes.md)).

## Plan summary

- The numbers live in a pure summarizer (`percentile`, `summarizeLatency`, `summarizeRate`) so later tickets can compare JSON runs without a device.
- A driver seam runs one tool: connect, one screen read, N tap-to-result Actions (`--screenshot`), optional case replays, disconnect.
- Yoqa uses the existing runner HTTP client. After each tap it reads the tree and scores whether the point landed on the intended element.
- Argent is optional until its CLI is on `PATH` (the command currently skips it with a message).
- Rejected: embedding a live Argent/Appium session in unit tests (needs a booted device).

## What shipped

- `yoqa benchmark --device <id> --platform ios|android [--repeats N] [--suite path] [--tools yoqa,argent] [--lane auto] [--out report.json] [--json]`
- Versioned suite: [`benchmark-suite.json`](./benchmark-suite.json) (`version: 1`). `--repeats` overrides `repeats`; bump `version` when taps or cases change.
- JSON report plus a text table. Yoqa rows include mean `action` / `settle` phases, `tapAccuracy`, and `casePassRate` when those samples exist.
- Format fixture: [`benchmark-baseline.json`](./benchmark-baseline.json) (synthetic Appium-lane series). Replace it with a hardware run via `--out docs/devices/benchmark-baseline.json`.

## How to verify

1. `yoqa benchmark --device <id> --platform ios`
2. Confirm the table has `tapToResult`, `screenRead`, `coldStart`, and `tapAccuracy` after a live tree read.
3. `bun test services/runner/src/domains/benchmark`

## Follow-ups

- A real Argent CLI adapter (the skip message goes away).
- Record a hardware baseline on the Appium lane and commit it over the fixture.
- Fill suite `cases` once a catalog App is part of the gate.
