# Environment, Diagnostics & Conventions

## Global conventions

- Every command accepts `--base-url <url>` (default `http://127.0.0.1:7420`).
- Nearly every command accepts `--json`. **Prefer `--json` whenever you intend to parse output** — the
  default human formats are terse and change; the JSON is the stable shape.
- Any command other than `serve` starts the local runner automatically if it isn't up, so you rarely
  need to start it by hand.

## Runner

```bash
yoqa health                 # is the runner reachable (JSON)
yoqa status                 # runner + runtime + AI provider + active device
yoqa status --json
yoqa serve                  # run the runner in the foreground
yoqa serve --stop           # stop a runner previously started by yoqa
```

`yoqa status` is the one-shot readiness check: it reports whether the runner is up, whether the
Argent runtime is ready, whether an AI provider is configured (needed for `--description` grounding
and agent runs), and which device is connected.

## Diagnose and repair

```bash
yoqa doctor                 # diagnose tooling, Argent, and the device session
yoqa doctor --json
yoqa doctor --fix           # apply the safe repairs it identified
```

`yoqa doctor` exits non-zero when something is wrong. `--fix` applies only repairs the report marked
safe (ensure runtime, disconnect a stuck session) and re-reports.
**Try `yoqa doctor --fix` before any manual recovery** — it covers most "it won't connect" cases.

## Argent runtime

```bash
yoqa runtime status         # readiness of Argent and host tools (non-zero if not ready)
yoqa runtime ensure         # verify Argent and host tools are ready
yoqa setup ios              # verify Argent iOS readiness
yoqa setup android          # verify Argent Android readiness
```

Install the CLI if it is missing: `npm install -g @swmansion/argent`.

## Servers and sessions

```bash
yoqa servers                # list the runner and device sessions
yoqa servers list
yoqa servers stop <id>      # stop one, id from `yoqa servers list`
yoqa servers restart <id>
yoqa servers stop-all
```

Use these when a session is wedged and `yoqa doctor --fix` didn't clear it. `yoqa servers stop-all`
disconnects the device session and does not stop the runner.
