# Runner sidecar version gate

## Goal

Stop packaged desktop upgrades from keeping a stale `yoqa-runner` on port 7420, which resurfaced the WDA `/$bunfs` icon `copyfile` ENOENT after installing 0.3.7.

## Plan summary

- **Decision:** Treat `/health` as compatible only when `version` matches the desktop app version; replace loopback listeners otherwise.
- **Rejected:** Relying on users to quit leftover runners after every DMG install.
- **Related:** WDA branding already uses Bun APIs for bunfs assets (`services/runner` 0.3.7); that fix never ran while 0.3.5 occupied the port.

## What shipped

- `apps/desktop/src/bun/features/runner-sidecar/index.ts` — fetch full health, compare versions, `lsof`+SIGTERM stale local listeners, wait for a matching runner before boot continues.
- Unit coverage for compatibility + local URL helpers.
- WDA icon branding writes materialized bytes (not a bunfs path copy).

## How to verify

1. Start an old runner (or leave one from a previous install) on `:7420`.
2. Launch a newer `/Applications/yoqa.app`.
3. `curl -s http://127.0.0.1:7420/health` should report the **new** app version.
4. Retry iOS device prep — WDA setup should no longer fail with `copyfile '/$bunfs/root/wda-icon-…'`.

Quick recovery without a new build: quit Yoqa, `pkill -f yoqa-runner`, reopen the app, confirm `/health` version.

## Follow-ups

- Ship a desktop release that includes this sidecar gate (bump past 0.3.7).
- Optional: surface “replaced stale runner X → Y” in the splash/boot UI.
