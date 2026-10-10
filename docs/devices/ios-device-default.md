# `device-ios` is the default on a cabled iPhone

## Goal

Make our own implementation (`device-ios`, the XCUITest `YoqaRunner` over usbmuxd) the lane `auto` picks for a physical iPhone, instead of Appium.

## Plan summary

[ios-device-benchmark.md](./ios-device-benchmark.md) cleared ADR-0004's gate on an iPhone 15 (iOS 27.0.1): tap-to-result p50 about 1.1 s against Appium's 2.6 s, tree read 0.4 s against 11 s. Rejected: keeping a per-class `directIsAutomatic` switch that always answers true; it is removed. Appium stays the lane for custom capabilities and the one-time loud fallback if the runner fails to build, sign or start.

## What shipped

- `select-lane.ts`: `directIsAutomatic` and the `selectLane` input are gone, so `auto` picks Direct whenever it is available, for every device class.
- `open-session.ts`, `direct-lane.ts`: stale comments and the unused wiring removed.
- Tests in `select-lane.test.ts`; glossary, ADR-0004 and the device docs updated.

## How to verify

1. `bun test services/runner/src/domains/devices`
2. Cable an unlocked, trusted iPhone, start a Run with lane `auto`: the Run report names `direct`. `YOQA_DIRECT_IOS_DEVICE` is unset, and `--lane appium` still forces Appium.

## Follow-ups

- Every `auto` Run on a phone now builds, signs and starts `YoqaRunner`; first-run signing problems surface as a fallback warning to Appium.
- Case pass rate on a phone is unmeasured, as for the simulator promotion.
