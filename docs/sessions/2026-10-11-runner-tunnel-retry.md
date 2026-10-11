# Retry the YoqaRunner tunnel before ending a session

## Goal

Stop the UI inspector dropping its Device Session with "Cannot reach YoqaRunner: usbmuxd does not list iPhone…" while the cable is fine and test runs work.

## Plan summary

Every runner command opens a fresh usbmuxd tunnel (`ListDevices` + `Connect`). The inspector's frame loop and tree reads run concurrently, so one transient usbmuxd miss was treated as an unplugged phone and ended the session. Retrying the open is safe because nothing has been sent yet. Rejected: retrying after a request is sent (could double-fire a gesture).

## What shipped

- `yoqa-runner-link.ts`: tunnel open retried up to 4 times with 150/300/450 ms backoff before `YoqaRunnerUnreachableError`; `tunnelRetryMs` option for tests.
- Unit test for a tunnel that fails twice, then opens.

- Follow-up (same branch): the 4-attempt retry only covers ~1 s, and the lane still ended the session on the first `YoqaRunnerUnreachableError`, so any longer usbmuxd gap killed the inspector while the runner was alive. `UsbmuxError`/`YoqaRunnerUnreachableError` now carry `transient` (phone not listed, usbmuxd hiccup). In `ios-device-lane.ts` a transient miss throws a plain error (the frame loop backs off and retries) and only becomes a Dead Session after `UNREACHABLE_GRACE_MS` (20 s) with no command getting through; a refused port or a runner exit still ends it immediately. Any successful reply resets the clock.

## How to verify

Run `bun test services/runner/src/domains/devices`. On a cabled iPhone, keep the UI inspector open for a few minutes with live view and tree refresh; the session should stay up.

## Follow-ups

Grace window is a guess (20 s). Root cause is inferred from code, not reproduced on hardware. If the error persists, capture `[yoqa-runner]` logs at the drop to see whether usbmuxd really stops listing the phone (screen lock, USB sleep).
