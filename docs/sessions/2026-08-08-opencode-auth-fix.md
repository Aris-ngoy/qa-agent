# OpenCode auth fix (PATH + Zen API key)

## Goal

Stop the OpenCode “`opencode` is not installed or not on PATH” / “Provider not authenticated” loop so vision runs can authenticate reliably — matching T3 Code’s CLI-first UX (no forced Zen API key paste).

## Plan summary

- Match T3 Code: CLI login (`opencode providers login`) is enough; optional Zen key / Server URL.
- Finder/Dock PATH and `which`-only probes miss `~/.opencode/bin`; harden discovery with home-bin fallbacks + `Bun.which`.
- Prefer monorepo runner in desktop so packaged Electrobun embeds do not shadow local fixes.
- Align local server handling with [t3code OpenCodeRuntime](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/opencodeRuntime.ts): Basic auth, CLI `opencode models`, spawn `opencode serve` for vision when no Zen key.

## What shipped

- Probe home-bin + `Bun.which`; OpenCode validate treats CLI found as connected
- Settings: CLI default; **no** “Paste an API key to continue” for OpenCode
- Vision: CLI mode spawns/reuses `opencode serve` (t3code-style) when no Zen key
- Sidecar prefers monorepo runner when repo marker / `YOQA_REPO_ROOT` is present

## How to verify

1. Quit `/Applications/yoqa.app` and restart monorepo desktop (`apps/desktop` `bun run dev`)
2. Add OpenCode with **CLI login** → continue without pasting a key → Validate shows Authenticated
3. Run a vision case (with `opencode providers login` already done) → no auth toast
4. Optional: API key mode still works for hosted Zen

## Follow-ups

- Idle TTL / shared serve lifecycle like t3code (reuse across requests, stop after idle)
- Rebuild macOS release so `/Applications/yoqa.app` includes these runner fixes
