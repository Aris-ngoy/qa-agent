# Current runner layout

Target layout after the architecture grill (2026-08). See `CONTEXT.md` for vocabulary and `docs/adr/` for decisions.

## `services/runner/src/domains/`

| Domain | Owns |
|--------|------|
| `devices/` | Device listing/prep, **Device Session** (create + Active Session), Screen (`getScreen`), Action (`performAction` + Grounding), MJPEG proxy |
| `appium/` | Appium Runtime install + **Appium Server** `ensureServer` |
| `ios/` | WDA / signing prep used when creating sessions |
| `providers/` | Provider adapters (settings + optional vision completion), secrets, catalog for UI |
| `runs/` | Run orchestration, **Case executor**, agent prompts/schema, Case Script parse consumers |
| `catalog/` | Apps, cases, flows, tags |
| `builds/` | Local build register/install |

## `interfaces/http/`

Thin adapters: parse Zod, call domain, map status (incl. Dead Session → 410). No grounding or tree-clean orchestration in routes.

## Dual config (interim)

- Desktop: `~/Library/Application Support/yoqa/settings.json` (toolchain prefs via Electrobun RPC)
- Runner: `~/.yoqa/` (db, Appium Runtime, WDA, providers, screenshots)

Long-term: runner is authority for prefs Appium/WDA need; desktop syncs into that store.
