# Latency benchmark: Yoqa vs Argent

## Goal

A repo-local harness drives the same connector scenario through Yoqa (and Argent when that CLI is installed) and reports tap-to-result p50/p95, screen-read time, and cold start. Ticket [#181](https://github.com/Aris-ngoy/qa-agent/issues/181). Gate for later Direct-lane work ([ADR-0004](../adr/0004-device-session-lanes.md)).

## Plan summary

- The numbers live in a pure summarizer (`percentile`, `summarizeLatency`) so later tickets can compare JSON runs without a device.
- A driver seam runs one tool: connect, one screen read, N tap-to-result Actions (`--screenshot`), disconnect.
- Yoqa uses the existing runner HTTP client. Argent is optional until its CLI is on `PATH` (the command currently skips it with a message).
- Rejected: embedding a live Argent/Appium session in unit tests (needs a booted device).

## What shipped

- `yoqa benchmark --device <id> --platform ios|android [--repeats 5] [--tools yoqa,argent] [--lane auto] [--out report.json] [--json]`
- JSON report plus a text table. Yoqa rows include mean `action` / `settle` phases when the Action result carries them.
- Format fixture: [`benchmark-baseline.json`](./benchmark-baseline.json) (synthetic Appium-lane series so later tickets have a stable shape). Replace it with a hardware run via `--out docs/devices/benchmark-baseline.json`.

## How to verify

1. Connect a booted simulator or emulator (or pass `--device` / `--platform` to the command).
2. `yoqa benchmark --device <id> --platform ios --repeats 5`
3. Confirm the table has `tapToResult`, `screenRead`, and `coldStart` p50/p95.
4. `bun test services/runner/src/domains/benchmark`

## Follow-ups

- [#182](https://github.com/Aris-ngoy/qa-agent/issues/182) adds tap accuracy and Case pass rate to the same report.
- A real Argent CLI adapter (the skip message goes away).
- Record a hardware baseline on the Appium lane and commit it over the fixture.
