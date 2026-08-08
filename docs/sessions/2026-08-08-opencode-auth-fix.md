# OpenCode auth fix (PATH + Zen API key)

## Goal

Stop the OpenCode “`opencode` is not installed or not on PATH” / “Provider not authenticated” loop so vision runs can authenticate reliably.

## Plan summary

- Vision uses Zen HTTP and always needs a resolvable API key (Settings, env, or CLI `auth.json`) — CLI binary presence alone is not enough.
- Finder/Dock PATH and `which`-only probes still miss `~/.opencode/bin`; harden discovery with absolute home-bin fallbacks.
- Default OpenCode to **API key** auth; keep the key field visible even for existing CLI-mode providers.
- Rejected: treating CLI-found as vision-authenticated (would keep green Validate while runs fail).

## What shipped

- [`services/runner/src/domains/providers/drivers/probe.ts`](../../services/runner/src/domains/providers/drivers/probe.ts) — after `which` fails, probe known home/Homebrew bins
- [`services/runner/src/domains/providers/drivers/opencode.ts`](../../services/runner/src/domains/providers/drivers/opencode.ts) — `authModes: ["api_key", "cli"]`; validate fails when CLI-only with no Zen key; env key resolution aligned with vision
- Settings UI — API key default + key field for OpenCode in CLI wizard and expanded details
- Toast — OpenCode-specific “paste key at opencode.ai/auth” description

## How to verify

1. Quit and relaunch the desktop app (runner picks up probe/validate changes)
2. Settings → OpenCode → paste a key from https://opencode.ai/auth → Validate → connected
3. Set as default → run a vision case → no “Provider not authenticated” toast
4. Optional: clear Binary path → Re-check → finds `~/.opencode/bin/opencode` without Terminal PATH

## Follow-ups

- Optionally read Zen key from OpenCode’s newer storage (DB) if `auth.json` is no longer written by `opencode providers login`
