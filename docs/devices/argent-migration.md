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

- [x] Inventory `agent-device` call sites (`cli.ts`, `devices.ts`, `runtime.ts`, `runner-install.ts`, `android-sdk.ts`, `developer-mode.ts`, `desktop-settings.ts`, `host-path.ts`).
- [x] Map to Argent equivalents (`server start/status`, `run`, `flow`, `tools`, devices, screenshot, snapshot, gestures, installs).
- [x] New `services/runner/src/domains/argent/` (bin resolve, version check, server lifecycle, devices, runtime with consent gate).
- [ ] Full session gesture cutover (screenshot-first `screen`, actions, installs still on `agent-device` fallback).
- [ ] Remove `services/runner/src/domains/agent-device/` + `domains/doctor` agent-device probes.
- [x] Update `domains/devices/` (Argent-first list with fallback), `interfaces/http/` (`/runtime`, `/status`, `/doctor`, `/devices/setup`), `packages/cli`, `packages/runner-client` schemas (`argent` check id, `argentVersion`, consent body).
- [ ] `bun test services/runner/src packages/runner-client/src packages/cli/src` green (scoped Argent/devices/doctor green; 1 pre-existing `opencode` provider failure).

### Phase 2 — Visual-first ordering

- [ ] `screen` returns cleaned tree + relative coords 0–1000 only on demand; default path is screenshot PNG.
- [ ] Grounding (`-d` description) prefers screenshot vision, tree as fallback.
- [ ] Autonomous runs loop updated (screenshot → decide → act).
- [ ] `packages/skill/yoqa-testing` inspect→act→verify rewritten visual-first.

### Phase 3 — Splash consent + global install

- [ ] `boot-gate.tsx` adds `prompt-install` phase (Argent missing/outdated → prompt, not auto-install).
- [ ] Consent copy: version pinned, PATH change, proprietary-binaries notice, telemetry opt-out.
- [x] `Install Argent` backend: `POST /runtime/ensure { consent: true }` (428 `CONSENT_REQUIRED` without consent); `doctor --fix` passes consent.
- [x] Runner `ensureArgentRuntime` handles no node/npm, offline, version mismatch; never installs without consent.
- [ ] Desktop + CLI `doctor --fix` parity for Argent (CLI `runtime ensure` passes consent; desktop prompt pending).

### Phase 4 — Cleanup + docs

- [ ] Desktop Devices/Settings/Diagnostics copy talks about Argent, not agent-device.
- [ ] `apps/docs` updated (device-preparation, desktop-app, cli, github-actions, best-practices).
- [ ] `rg agent-device` only hits historical notes / DB compat (or zero, if decided).
- [ ] `bun run lint:ci`, `bun run check`, `bun run test` green.
- [ ] Manual verify: fresh machine without Argent → prompt → Accept boots `ready`; Decline boots limited; sim + physical iOS/Android `devices/screen/screenshot/action`.

## What shipped

Increment 1 — Argent runtime + device-listing adapter (session gestures still on `agent-device` fallback).

| Area | File / API | Status |
|------|------------|--------|
| Branch | `devices/argent-migration` | Done |
| Plan | `docs/devices/argent-migration.md` | Done, tracker updated |
| License guardrail | `docs/devices/argent-license-guidelines.md` | Done |
| Runner adapter | `services/runner/src/domains/argent/cli.ts`, `devices.ts`, `runtime.ts`, `cli.test.ts` | Done |
| Runtime API | `GET /runtime`, `POST /runtime/ensure { consent }`, `GET /status`, `POST /devices/setup`, doctor Argent server probe | Done |
| Device listing | `domains/devices/application.ts` Argent-first with `agent-device` fallback | Done |
| Client | `packages/runner-client` schemas + `ensureRuntime({ consent })`, CLI copy | Done |
| Visual-first screen | `domains/devices`, `testing/` | Not started |
| Splash consent UI | `apps/desktop/src/mainview/features/splash/boot-gate.tsx` | Not started |
| Skill + docs | `packages/skill/yoqa-testing`, `apps/docs` | Not started |

Tool mapping used: `devices` → `list-devices`, `open` → `boot-device` + `launch-app`, `snapshot -i` → `describe`, `screenshot` → `screenshot`, `press` → `gesture-tap`, `swipe`/`gesture pan` → `gesture-swipe`/`gesture-custom`, `type` → `keyboard`, `install` → `reinstall-app`, `open-url` → `open-url`, `home`/`back` → `button`, `close --session` → `stop-simulator-server`, `doctor` → `server status` + `native-devtools-status`.

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
