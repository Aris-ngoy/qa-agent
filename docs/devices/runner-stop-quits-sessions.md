# The runner quits its Device Sessions when it stops

## Goal

Nothing Yoqa launched outlives the runner ([#381](https://github.com/Aris-ngoy/qa-agent/issues/381), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). On SIGINT or SIGTERM the runner used to `process.exit(0)` at once. A browser Yoqa launched kept running with its Kept profile's `SingletonLock` held, so the next connect on that App and browser failed with `ProfileInUseError` until the user quit the window by hand. `yoqa-sim` and adb-forwarded sessions were left to their own timeouts. Vocabulary: **Active Session**, **Device Session**, **Kept profile**, **Lane** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Quit, bounded.** The first signal stops the HTTP server (the port is free at once and no connect races in), marks any Run in progress cancelled, then quits every open Device Session, and exits once they have quit or after 5 s, whichever is first. A second signal while quitting exits at once.
- **Every session, held or not.** `disconnectDevice` refuses while a Run holds the Active Session, so the stop quits the sessions directly: the Active Session and any detached session a Run opened, taken from the one-per-device registry in `open-session.ts`.
- **Quitting stays per Lane.** Each session quits as on disconnect: a launched browser is killed and keeps its Kept profile (a clean one is deleted), the Everyday browser and attach by port close only Yoqa's window or socket, phones end as they do on disconnect.
- **A Run in progress is cancelled**, not left `running`. It is one write per Run and fits well inside the cap; its queued and running cases say "The runner stopped". Rejected: leaving it for a restart to find, which would show a Run `running` forever.
- **Exit codes:** 0 once the sessions quit, 1 when the cap ran out, 130 on a second signal.

## What shipped

- `services/runner/src/stop-runner.ts`: `stopRunner({ quit, exit, capMs, log })` returns the signal handler; `index.ts` passes the real quit and `process.exit`, on `process.on` so a second signal reaches it.
- `active-session.ts`: `quitEverySession()` drops the Active Session, held by a Run or not, cuts the MJPEG proxies and quits it with every other open session (`quitOpenDeviceSessions()` in `open-session.ts`). A session that fails to quit does not stop the others.
- `runs/application.ts`: `cancelRunsInProgress()` aborts every Run with a control and persists it cancelled.
- `fakeChromium` takes `locksProfile`: a running fake holds the profile's `SingletonLock` as Chromium does and lets it go when killed, with `isProcessAlive` for its pids. `webDirectDeps` takes `isProcessAlive`.
- Tests: the handler in `stop-runner.test.ts` (quits before exit, exits after the cap, at once on a second signal, after a failed quit); in `active-session.test.ts`, the stop quits the Active Session, a Run-held one and a detached one, a launched browser's process is gone with its lock released and its Kept profile kept (a reconnect launches again), and a clean profile's folder is deleted; in `web-run.test.ts`, a Run in progress ends `cancelled`.

## How to verify

```bash
cd services/runner
bun test src/stop-runner.test.ts src/domains/devices/active-session.test.ts src/domains/runs/web-run.test.ts
```

By hand on a Mac with Chrome: run the runner, `yoqa devices connect web-chrome --app <app>`, then Ctrl-C the runner. The window closes, the log says `SIGINT — quitting device sessions, then stopping`, and after a restart the same connect opens the Kept profile again, still signed in.

## Follow-ups

- A `SIGKILL` (or a crash) still skips all of this; a launch then finds the lock stale, since its pid is gone, and goes ahead.
