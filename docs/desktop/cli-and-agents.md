# CLI & Agents (Settings install + full agent CLI)

## Goal

Make Settings → **CLI & Agents** fully functional (Install CLI, Install skill, Open folder, live status), and implement the ARCHITECTURE §2.7 `yoqa` CLI surface so coding agents can debug devices and manage local catalog/runs end-to-end.

## Plan summary

- Settings install via **desktop Bun RPC** (same pattern as iOS toolchain), not a runner `environment/` domain.
- Interactive device loop (connect / screen / action) via runner HTTP + active Appium session registry.
- Catalog/runs CLI as thin wraps over existing HTTP; add app `prefix` for skill-style args.
- Builds domain registers local `.ipa` / `.app` / `.apk` and installs on run when `buildId` / `buildPath` is set.
- Local `-d` grounding + `yoqa status` (no cloud auth yet); skill wording updated for local BYO providers.

## What shipped

### Desktop Settings → CLI & Agents

- RPC: `getCliEnvironment`, `installCli`, `installSkill`, `openSkillFolder`
- CLI symlink: `~/.local/bin/yoqa` → App Support wrapper that runs `bun` on the runner CLI entry
- Skill: copy to `~/Library/Application Support/yoqa/skills/yoqa-testing`, symlink into Standard / Claude / Cursor / Codex skill dirs
- UI wired with live ✓/× status, Install/Reinstall, Open folder

### Runner / CLI

- Active session: `POST /devices/connect`, `GET /devices/active`, `POST /devices/disconnect`
- `GET /screen`, `POST /screenshot`, `POST /action` (tap/swipe/drag/input/lifecycle/open-url/alert + optional `-d` grounding)
- `GET /status` — runner, runtime, provider, active device
- Apps gain unique `prefix`; CLI resolves `APP` by prefix
- Catalog CLI: `apps`, `cases`, `flows`, `tags`
- Builds: `domains/builds/`, `/builds`, CLI `builds list|create|delete`; runs honor `buildId` / `buildPath`
- Runs CLI: `runs list|get|delete|create` (case numbers + active device default)
- Skill docs updated for local provider-based grounding (no cloud sign-in gate)

## How to verify

1. Open desktop → Settings → CLI & Agents → **Install** CLI, then in a new terminal: `yoqa health`
2. **Install** skill → four targets show ✓; **Open folder** reveals App Support skill tree
3. With runner up and a booted simulator:
   ```bash
   yoqa devices ios --booted-only
   yoqa devices connect <udid> --platform ios
   yoqa screen
   yoqa action tap --x 500 --y 500
   ```
4. Catalog: `yoqa apps list`, `yoqa cases list <prefix>`
5. With a Provider configured: `yoqa action tap -d "…"` and `yoqa status`

## Follow-ups

- Bundle skill into packaged Electrobun resources (`build.copy`) for non-dev installs
- Uninstall CLI / skill buttons
- Richer screen cleanup + swipe-by-description
- Cloud auth / credits when that product surface exists
- Replace mock builds in desktop runs UI with `/builds` list
