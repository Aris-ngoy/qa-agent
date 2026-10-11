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

## Diagnostics (same branch)

To see why a session ends, the full error now travels with it:

- The causes are now chained (`DeadSessionError` ← `YoqaRunnerUnreachableError` ← `UsbmuxError`), and `UsbmuxError.listed` records what usbmuxd did list (`udid (ConnectionType)`).
- When a session ends, the lane logs `[yoqa-runner] Device session ended on iPhone <udid>` once, with the time it was unreachable (`unreachableMs`), `graceMs` and the cause chain from `errorChain()`, including stacks.
- The 410 "Device session ended" body carries the same `chain`. `RunnerRequestError` in `@yoqa/runner-client` keeps the HTTP status and body, and in dev builds the desktop's `logDevError` prints them to the webview console as `[yoqa] …`.

## Inspector freeze on the Direct lane (same branch)

Symptom: on a physical iPhone (Direct lane, `stream: null`, so screenshot polling) the inspector showed the first frame and then never updated.

- Background poll ticks (`silent: true`) returned quietly on a dead-session error, so the last frame stayed up with no reconnect prompt. Now they end the session on a 410 like the first fetch does (the "confirm with the runner" step first shipped here was replaced; see Unreachable Session below).
- Every runner response now carries `Cache-Control: no-store` (a 410 is cacheable by default) and `X-Yoqa-Runner-Pid`. `RunnerRequestError.answeredBy` records the URL, pid and `Date` of the response.
- Dev logs from the webview now reach the `bun run dev` terminal as `[yoqa:webview] …` through Vite's HMR socket (`app/dev-log.ts`, the `webviewDevLog` plugin in `vite.config.ts`). The inspector logs page visibility, poll start and pause, polls stuck behind an in-flight request, and silent poll errors.

Open: some 410s reached the app without the runner logging the session's death or abandonment, and without `chain`. The pid header should show which process answers them. I could not reproduce a session drop under inspector-like load (119/119 frames, no socket leak, usbmuxd listed the phone in 240/240 concurrent lookups).

## Unreachable Session and Frame Feed (same branch)

Goal: the 410s in the "it worked before" report came from a runner without the pid header (stale process or cached reply), and the cabled iPhone then looked broken because of two labels, not a failure.

Plan summary: the runner is the only judge of when a session is dead; the desktop never second-guesses a 410. Report how frames arrive separately from whether the session is up. Rejected: keeping the desktop's own 15 s stall timer alongside the runner's 20 s grace (two clocks for one decision).

What shipped:

- `DeviceUnreachableError` (lane.ts): the iPhone Direct lane throws it inside its grace window, with `unreachableMs` and `graceMs`. Session routes answer it **503 `Device unreachable`** and keep the session; a Dead Session still answers 410 and is dropped first.
- The Inspector feed treats 503 as an Unreachable Session (keeps the last frame, polls about once a second) and every 410 as final. The "session gone, but the runner still lists it" re-check and the desktop stall timer are gone.
- `streamState: "ready" | "none" | "failed"` on the Active Session (`streamReady` stays for older clients). The Servers row says `connected · screenshot poll` instead of `connecting`; Doctor only warns on `failed`; the connect toast says "Connected — screenshot poll", and "live stream unavailable" only when a stream failed.
- Glossary: **Unreachable Session**, **Frame Feed** (`CONTEXT.md`).

How to verify: `bun test services/runner/src/domains/devices services/runner/src/interfaces/http apps/desktop/src/mainview/features`. On a cabled iPhone: Connect shows "Connected — screenshot poll", Servers shows `connected · screenshot poll`; pull the cable for under 20 s and the frame freezes then resumes; past 20 s the Inspector says the session ended.

Follow-ups: `errorChain` test failed once in five full-suite runs (order-dependent); the Appium and other Direct lanes do not raise Unreachable Session yet. Frame and tree reads later moved to the [Inspector Session](../devices/inspector-session.md), so a usbmux miss on the inspector poll no longer ends the Device Session at all.
