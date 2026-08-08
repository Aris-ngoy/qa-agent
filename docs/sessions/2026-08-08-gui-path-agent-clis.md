# GUI PATH for agent CLIs (OpenCode / Grok)

## Goal

Fix Settings provider probe reporting `` `opencode` is not installed or not on PATH `` when OpenCode is installed under `~/.opencode/bin`.

## Plan summary

- Finder/Dock launches strip shell PATH; `pathWithHostTools` already restored Homebrew / `~/.local/bin` / Bun.
- OpenCode (and often Grok) live in dedicated home bins not covered by that list.
- Apply the same PATH at runner startup so provider probes always see those dirs.

## What shipped

- `services/runner/src/domains/appium/host-path.ts` — prepend `~/.opencode/bin`, `~/.grok/bin`, `~/.antigravity/antigravity/bin`
- `services/runner/src/index.ts` — `ensureHostToolPath()` at boot
- Desktop sidecar PATH mirror updated to match
- Unit test expectations updated

## How to verify

1. Restart desktop / runner after install
2. Settings → Provider → OpenCode probe should find CLI when present at `~/.opencode/bin/opencode`
3. Or: `PATH=/usr/bin:/bin bun -e '…'` with `pathWithHostTools` then `which opencode`

## Follow-ups

- None for standard install locations; custom binary paths remain via Settings
