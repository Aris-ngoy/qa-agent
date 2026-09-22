# Current runner layout

Target layout after the architecture grill (2026-08). See `CONTEXT.md` for vocabulary and `docs/adr/` for decisions.

## `services/runner/src/domains/`

| Domain | Owns |
|--------|------|
| `devices/` | Device listing, **Device Session** (create + Active Session), Screen (`getScreen`), Action (`performAction` + Grounding) |
| `argent/` | Argent CLI adapter — sessions, screen snapshots, gestures, list-devices, runtime readiness |
| `ios/` | Legacy WDA / signing prep (unused since the backend cutover; kept for reference) |
| `providers/` | Provider adapters (settings + optional `vision.completeObject`), secrets, catalog for UI |
| `runs/` | Run orchestration, **Case executor**, agent prompts/schema, Case Script parse consumers |
| `catalog/` | Apps, cases, flows, tags |
| `builds/` | Local build register/install |

## `interfaces/http/`

Thin adapters: parse Zod, call domain, map status (incl. Dead Session → 410). No grounding or tree-clean orchestration in routes.

## Dual config (interim)

- Desktop: `~/Library/Application Support/yoqa/settings.json` (toolchain prefs via Electrobun RPC)
- Runner: `~/.yoqa/` (db, providers, screenshots). Argent manages its own state and runner — there is no Yoqa-managed device-automation cache dir.

Long-term: runner is authority for provider/auth prefs; desktop syncs into that store.
