# OpenCode auth fix (PATH + Zen API key)

## Goal

Stop the OpenCode “`opencode` is not installed or not on PATH” / “Provider not authenticated” loop so vision runs can authenticate reliably.

## Plan summary

- Vision uses Zen HTTP and always needs a resolvable API key (Settings, env, or CLI `auth.json`) — CLI binary presence alone is not enough for hosted Zen.
- Finder/Dock PATH and `which`-only probes still miss `~/.opencode/bin`; harden discovery with absolute home-bin fallbacks + `Bun.which`.
- Default OpenCode to **API key** auth; keep the key field visible even for existing CLI-mode providers.
- Align local server handling with [t3code OpenCodeRuntime](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/opencodeRuntime.ts): Basic `opencode:<password>` auth, CLI `opencode models` inventory, Server URL as a vision auth path.
- Rejected: treating CLI-found as vision-authenticated without key or server URL.

## What shipped

- [`services/runner/src/domains/providers/drivers/probe.ts`](../../services/runner/src/domains/providers/drivers/probe.ts) — after `which` fails, probe known home/Homebrew bins; prefer `Bun.which`
- [`services/runner/src/domains/providers/drivers/opencode.ts`](../../services/runner/src/domains/providers/drivers/opencode.ts) — API-key-first; Basic server auth; CLI models list; validate fails when CLI-only with no Zen key/server
- [`services/runner/src/domains/providers/vision-model.ts`](../../services/runner/src/domains/providers/vision-model.ts) — Server URL counts as vision auth; Basic auth fetch hooks for local serve
- Settings UI — API key default + key field for OpenCode in CLI wizard and expanded details
- Toast — OpenCode-specific “paste key at opencode.ai/auth” description

## How to verify

1. Quit and relaunch the desktop app (runner picks up probe/validate changes)
2. Settings → OpenCode → paste a key from https://opencode.ai/auth → Validate → connected
3. Set as default → run a vision case → no “Provider not authenticated” toast
4. Optional: clear Binary path → Re-check → finds `~/.opencode/bin/opencode` without Terminal PATH
5. Optional: `opencode serve` + Server URL + `OPENCODE_SERVER_PASSWORD` → Validate connected without Zen key

## Follow-ups

- Optionally spawn a managed `opencode serve` process (full t3code lifecycle) instead of requiring an external Server URL
- Read additional auth shapes if OpenCode migrates fully off `auth.json`
