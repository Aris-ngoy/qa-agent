# Remove Appium in favor of agent-device

> **Historical:** written for the pre-Argent backends (Appium, then `agent-device`). Both are gone — the Argent backend replaced `agent-device` (see `docs/adr/0004-argent-backend.md`). Kept for history; commands and paths below may no longer exist.

## Goal

Yoqa should not install, run, configure, or expose Appium. Device control is agent-device only.

## Plan summary

The runner already shells out to `agent-device` for sessions, snapshots, and gestures. What remained was leftover Appium UI, unused WDA/Appium-era modules, vendored Appium skills, and copy that still told operators to set capabilities or start an Appium server.

Decisions:

- Delete unused Appium-era runner code (`domains/ios` WDA installer, WebDriverIO keyboard/gestures/alerts helpers).
- Remove Custom Appium Capabilities from app and case configuration.
- Delete `.agents/appium-skills` and the Appium setup/troubleshooting skills.
- Keep unused `appium_caps` SQLite columns (NOT NULL default `[]`) so existing catalog DBs keep opening. The API still returns empty `capabilities` arrays for wire compat.
- Leave historical session notes / ADRs as written history.

Rejected: a SQLite migration to drop `appium_caps` in this cut; keeping the Appium capabilities editors as hidden advanced fields.

## What shipped

- Desktop: no capabilities editors; Settings/doctor/Android copy talks about agent-device.
- Runner: no Appium session bridge, no unused WDA installer, no WebDriverIO leftover modules.
- Skills: yoqa-testing references no longer mention Appium runtime/drivers; Appium skill pack removed.
- CI/docs: cache and release notes no longer say we ship or manage Appium.

## How to verify

1. `bun test services/runner/src packages/runner-client/src packages/cli/src apps/desktop/src`
2. Open desktop → Apps → Configuration: no capabilities section. Test case Configuration: no Appium Capabilities card.
3. Settings → Android / Diagnostics mention agent-device, not Appium.
4. `rg -g '!docs/sessions/**' -g '!docs/adr/**' -g '!docs/plans/**' -g '!docs/ios/**' appium` should only hit leftover DB column names and historical notes.

## Follow-ups

- Optional catalog migration to drop `appium_caps` columns.
- Optional: drop empty `capabilities` from the HTTP catalog schemas in a later breaking client bump.
