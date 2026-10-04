# Spike: idb_companion vs WDA on an iOS simulator

## Goal

Time-box Meta’s `idb_companion` against the current Appium / WebDriverAgent path on the **same** simulator, then pick a backend for an iOS Direct lane — or drop the idea. Ticket [#188](https://github.com/Aris-ngoy/qa-agent/issues/188). No production Device Session code. Vocabulary: **Lane**, **Screen**, **Settle** in [`CONTEXT.md`](../../CONTEXT.md). Gate: [ADR-0004](../adr/0004-device-session-lanes.md).

## Plan summary

- Measure companion screenshot, tree, tap, and tap-then-screenshot on a booted simulator. Drive Yoqa’s Appium lane through `yoqa benchmark` on that UDID so the WDA numbers come from the same harness as later Direct work.
- Inspect whether the tree can see **system** UI (`--format complete` `modal`, `--api axbridge`).
- Record the install story (Homebrew tap vs GitHub binary vs PyPI client) and Xcode compatibility. Do **not** `brew trust facebook/fb` without an explicit human yes.
- Rejected as this spike’s output: shipping a Lane factory, vendoring the binary in `packages/`, or claiming a vs-Argent p50. The public `argent` CLI is still MCP/flow, not a tap-to-result driver (`yoqa benchmark --tools argent` skips).

## What shipped

Recommendation: **adopt** `idb_companion` as the iOS-**simulator** Direct backend. Open follow-ups [#198](https://github.com/Aris-ngoy/qa-agent/issues/198) (lane) and [#199](https://github.com/Aris-ngoy/qa-agent/issues/199) (Screen / Settle / vs-Appium gate). Physical iOS stays Appium.

Hardware: iPhone 17 Pro simulator, iOS 26.5, UDID `B75001FB-B91D-4F94-80A7-3E371A641D27`. Host Xcode 27.0 (27A266a). Companion `v1.6.5` (`build_date: Oct 2 2026`). Client `fb-idb==1.6.5`. Raw JSON: [`benchmark-idb-spike.json`](./benchmark-idb-spike.json).

### Numbers (same simulator)

| Path | metric | p50 | p95 | n | notes |
|------|--------|-----|-----|---|-------|
| idb CLI | screenshot | 151 ms | 152 ms | 5 | PNG 1206×2622 |
| idb CLI | tree (`describe-all`, default AX) | 151 ms | 158 ms | 5 | 5 flat nodes on this RN screen |
| idb CLI | tree (`--api axbridge --format complete`) | 204 ms | 213 ms | 5 | 37 nodes; first call 933 ms |
| idb CLI | tap (`ui tap --api hid`) | 247 ms | 248 ms | 5 | |
| idb CLI | tap-to-result (tap + screenshot, no Settle) | 396 ms | 400 ms | 5 | |
| idb CLI | `ui quiet` | ~387 ms | — | 1 | companion idle/animation probe |
| **yoqa / Appium / WDA** | **tapToResult** | **3137 ms** | **3454 ms** | **3** | harness; Settle mean 771 ms |
| yoqa / Appium / WDA | screenRead | 5243 ms | 5243 ms | 1 | |
| yoqa / Appium / WDA | coldStart | 84996 ms | 84996 ms | 1 | WDA + Appium session |
| yoqa / Appium / WDA | tapAccuracy | 1.00 | — | 3 | |

idb tap-to-result is ~8× the Appium p50 even **without** Yoqa Settle. Screen read is ~25× (axbridge) to ~35× (default AX). Adding a 160 ms stable-frame Settle to idb would still leave it well under 1 s.

Argent: not measured. Same skip as the Android Direct gate.

### System dialogs

`--format complete` exposes `modal`. Opening Maps on this sim produced:

```text
modal.kind = system
modal.element_type = _UIAlertControllerPhoneTVMacView
modal.label = Allow “Maps” to use your location?
```

Default AX is frontmost-app and sparse (RN WebView → five nodes). `axbridge` is the backend that crosses process boundaries (Safari/WKWebView, SpringBoard alerts). A Direct Screen must read `modal` **and** the axbridge tree, not the flat default array alone.

### Install story

| Path | Result |
|------|--------|
| `brew install facebook/fb/idb-companion` | Homebrew refused the untrusted tap. **Did not** `brew trust`. |
| GitHub release `idb_companion.macos-arm64.tar.gz` (`facebook/idb` `v1.6.5`) | Extract and run. Built 2 Oct 2026. |
| PyPI `fb-idb==1.6.5` | Client only. `idb connect 127.0.0.1 10882` then `--udid`. |

Companion was started as `idb_companion --udid <sim> --grpc-port 10882`. It enumerates attached **physical** iPhones via MobileDevice before serving the sim — pairing noise, not a blocker, and a reason not to log companion output in CI.

Xcode 27 + iOS 26.5 sim: companion `--list` and `--udid` both worked.

### Rejected options

- **Own helper** (AX daemon + HID, Argent-shaped): Argent’s fast path is private. No vs-Argent number exists to justify a from-scratch stack.
- **WDA-direct** (HTTP to WDA, skip Appium): still on the XCUITest/WDA floor that just read 3.1 s tap-to-result / 5.2 s screen. Not the Direct win.
- **Drop iOS Direct**: only if the companion could not run or could not beat WDA. It runs on current Xcode and beats WDA by a wide margin.

## How to verify

1. Read this doc and [`benchmark-idb-spike.json`](./benchmark-idb-spike.json).
2. On a booted simulator (companion from the `v1.6.5` GitHub release, not Homebrew):

```bash
idb connect 127.0.0.1 10882
# time screenshot / ui describe-all / ui tap as in the JSON
bun packages/cli/src/main.ts benchmark --device <udid> --platform ios --lane appium --repeats 3
```

3. Confirm [#198](https://github.com/Aris-ngoy/qa-agent/issues/198) and [#199](https://github.com/Aris-ngoy/qa-agent/issues/199) are open. iOS Direct is **not** dropped.

## Follow-ups

- [#198](https://github.com/Aris-ngoy/qa-agent/issues/198): iOS-simulator Direct lane — [ios-direct-lane.md](./ios-direct-lane.md).
- [#199](https://github.com/Aris-ngoy/qa-agent/issues/199): axbridge + `modal` — [ios-direct-tree-settle.md](./ios-direct-tree-settle.md).
- Physical iOS stays Appium. Companion talking to a plugged-in iPhone is out of scope.
- Parked [#174](https://github.com/Aris-ngoy/qa-agent/issues/174)–[#178](https://github.com/Aris-ngoy/qa-agent/issues/178) stay parked.
