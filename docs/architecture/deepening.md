# Architecture deepen — Device Session, Screen/Action, Providers, Runs

## Goal

Turn shallow / misplaced modules into deep ones at clean seams: Device Session locality, thin HTTP, Provider catalog + vision capability, testable Case executor, one Case Script parse.

## Plan summary

Decisions locked in grill + ADRs `0001`–`0003`. Rejected: Device Session under `runs/` or `appium/`, dual dead-session regexes, `VISION_KINDS` beside drivers, testing only leaf pure helpers.

Deferred (follow-ups): per-driver `vision.completeObject`, dual config store sync, routing Cursor/Antigravity CLI fully through adapters.

## What shipped

- **Device Session** (`devices/session.ts`): moved from `runs/`; per-device exclusivity; `isDeadSessionError` / `DeadSessionError`
- **Appium Server** (`appium/server.ts`): `ensureAppiumServer` extracted from session
- **Screen & Action** (`devices/interaction.ts`): `getScreen` (MJPEG pause default), `performAction` (Grounding inside); HTTP `session` routes thinned
- **Providers:** `capabilities.vision` + `description` on drivers; `GET /providers/catalog`; client `listProviderCatalog()`; Settings UI prefers runner catalog (logos local)
- **Case executor** (`runs/case-executor.ts`): injectable session/decide/clock/abort; uses `performAction`; unit tests; `executeRun` stays orchestration
- **Case Script:** catalog imports `parseCaseScript` from `runs/script` (duplicate removed)
- **Docs:** `CONTEXT.md`, ADRs, `ARCHITECTURE.md` §12, `current-layout.md`

## How to verify

```bash
bun run test
bun run check
bun run lint:ci
# Optional: start runner, GET /providers/catalog; connect device → screen/action
```

## Follow-ups

- Per-driver `vision.completeObject` (remove remaining kind switches in agent/grounding)
- Runner as authority for toolchain prefs Appium/WDA need (config sync)
- Case executor `getScreen` for tree-aware steps if needed
