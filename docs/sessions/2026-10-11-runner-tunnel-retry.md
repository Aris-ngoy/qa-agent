# Retry the YoqaRunner tunnel before ending a session

## Goal

Stop the UI inspector dropping its Device Session with "Cannot reach YoqaRunner: usbmuxd does not list iPhone…" while the cable is fine and test runs work.

## Plan summary

Every runner command opens a fresh usbmuxd tunnel (`ListDevices` + `Connect`). The inspector's frame loop and tree reads run concurrently, so one transient usbmuxd miss was treated as an unplugged phone and ended the session. Retrying the open is safe because nothing has been sent yet. Rejected: retrying after a request is sent (could double-fire a gesture).

## What shipped

- `yoqa-runner-link.ts`: tunnel open retried up to 4 times with 150/300/450 ms backoff before `YoqaRunnerUnreachableError`; `tunnelRetryMs` option for tests.
- Unit test for a tunnel that fails twice, then opens.

## How to verify

Run `bun test services/runner/src/domains/devices`. On a cabled iPhone, keep the UI inspector open for a few minutes with live view and tree refresh; the session should stay up.

## Follow-ups

Root cause is inferred from code, not reproduced on hardware. If the error persists, capture `[yoqa-runner]` logs at the drop to see whether usbmuxd really stops listing the phone (screen lock, USB sleep).
