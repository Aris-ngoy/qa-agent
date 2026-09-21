# Argent migration (replace agent-device)

## Goal

Replace the `agent-device` device backend with Argent (`https://github.com/software-mansion/argent`), visual-first:

- Primary perception = screenshot PNG.
- Secondary / fallback = snapshot / accessibility tree.
- No Appium / APIM runtime, no `agent-device` runtime after the cut.
- Splash screen checks for Argent and offers a consent-gated global install.
- No Argent license violations (Apache-2.0 source + proprietary binaries).

Related: [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`CONTEXT.md`](../../CONTEXT.md), [Remove Appium](./remove-appium.md), [Argent license guidelines](./argent-license-guidelines.md).

## Plan summary

Key decisions:

- One plan → one branch: `devices/argent-migration` from `main`.
- New adapter `services/runner/src/domains/argent/` replaces `services/runner/src/domains/agent-device/` (resolve bin, `server start`, devices, screenshot-first screen, gestures, installs, runtime status).
- Accept flow = `npm install -g @swmansion/argent` then `argent init --global` (MCP + skills). Decline = limited boot with Devices/Runs gated.
- Splash `BootGate` gains a `prompt-install` phase; `ensure` requires explicit consent, never silent global writes.

Rejected alternatives:

- Keeping `agent-device` as fallback shim (drops the visual-first simplification, doubles doctor paths).
- Silent auto-install of Argent on boot without user consent.
- Vendoring Argent binaries into this repo or the DMG.

## Migration tracker

Pause / resume here. Check a box only when the item is done on this branch.

### Phase 0 — Branch + docs

- [x] Branch `devices/argent-migration` created from up-to-date `main`.
- [x] Plan saved in `docs/devices/argent-migration.md`.
- [x] License guideline saved in `docs/devices/argent-license-guidelines.md`.
- [ ] PR opened against `main` with test plan.

### Phase 1 — Runner adapter (`agent-device` → Argent)

- [ ] Inventory `agent-device` call sites (`cli.ts`, `devices.ts`, `runtime.ts`, `runner-install.ts`, `android-sdk.ts`, `developer-mode.ts`, `desktop-settings.ts`, `host-path.ts`).
- [ ] Map to Argent equivalents (`server start/status`, `run`, `flow`, `tools`, devices, screenshot, snapshot, gestures, installs).
- [ ] New `services/runner/src/domains/argent/` (bin resolve, version check, server lifecycle, devices, screenshot-first `screen`, actions, installs).
- [ ] Remove `services/runner/src/domains/agent-device/` + `domains/doctor` agent-device probes.
- [ ] Update `domains/devices/`, `testing/`, `interfaces/http/` (`/runtime`, `/status`, `/doctor`), `packages/cli`, `packages/runner-client` schemas.
- [ ] `bun test services/runner/src packages/runner-client/src packages/cli/src` green.

### Phase 2 — Visual-first ordering

- [ ] `screen` returns cleaned tree + relative coords 0–1000 only on demand; default path is screenshot PNG.
- [ ] Grounding (`-d` description) prefers screenshot vision, tree as fallback.
- [ ] Autonomous runs loop updated (screenshot → decide → act).
- [ ] `packages/skill/yoqa-testing` inspect→act→verify rewritten visual-first.

### Phase 3 — Splash consent + global install

- [ ] `boot-gate.tsx` adds `prompt-install` phase (Argent missing/outdated → prompt, not auto-install).
- [ ] Consent copy: version pinned, PATH change, proprietary-binaries notice, telemetry opt-out.
- [ ] `Install Argent` → `POST /runtime/ensure { consent: true }` with progress; `Not now` → limited boot, Devices gated + Settings retry.
- [ ] Runner `ensureArgentRuntime` handles no node/npm, sudo/password, offline, version mismatch as splash `error` + Retry.
- [ ] Desktop + CLI `doctor --fix` parity for Argent.

### Phase 4 — Cleanup + docs

- [ ] Desktop Devices/Settings/Diagnostics copy talks about Argent, not agent-device.
- [ ] `apps/docs` updated (device-preparation, desktop-app, cli, github-actions, best-practices).
- [ ] `rg agent-device` only hits historical notes / DB compat (or zero, if decided).
- [ ] `bun run lint:ci`, `bun run check`, `bun run test` green.
- [ ] Manual verify: fresh machine without Argent → prompt → Accept boots `ready`; Decline boots limited; sim + physical iOS/Android `devices/screen/screenshot/action`.

## What shipped

None yet — planning cut only (branch + these docs).

| Area | File / API | Status |
|------|------------|--------|
| Branch | `devices/argent-migration` | Done |
| Plan | `docs/devices/argent-migration.md` | Done |
| License guardrail | `docs/devices/argent-license-guidelines.md` | Done |
| Runner adapter | `services/runner/src/domains/argent/` | Not started |
| Visual-first screen | `domains/devices`, `testing/` | Not started |
| Splash consent | `apps/desktop/src/mainview/features/splash/boot-gate.tsx` | Not started |
| Skill + docs | `packages/skill/yoqa-testing`, `apps/docs` | Not started |

## How to verify

1. `git status --short --branch` shows `devices/argent-migration`, clean.
2. These two docs exist and render: `docs/devices/argent-migration.md`, `docs/devices/argent-license-guidelines.md`.
3. Later cuts: `bun run lint:ci`, `bun run check`, `bun test services/runner/src packages/runner-client/src packages/cli/src apps/desktop/src`.
4. Later manual: splash prompt on machine without Argent; Accept installs globally and reaches `ready`; Decline reaches limited boot.

## Follow-ups

- Decide final `agent-device` string purge scope (history vs zero hits).
- Decide Argent version pin + `--local` vs global for team repos.
- TV / Electron scope (Argent supports more than iOS/Android).
- Drop empty `capabilities` / `appium_caps` compat in a later breaking client bump.
