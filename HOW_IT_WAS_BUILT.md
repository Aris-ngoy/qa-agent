# How noqa was built (from public artifacts + local DMG)

Sources: [noqa.ai](https://noqa.ai/), [github.com/noqa-ai/noqa](https://github.com/noqa-ai/noqa), extracted `noqa.app` v2.0.12 from `noqa.dmg`.

## Bottom line

The **app source is private**. The public GitHub repo is docs/marketing + a Cursor/Claude **skill**, not the desktop codebase. The shipped Mac app is a **Tauri 2** shell around a **Vite/React** UI, talking to a local **Python FastAPI** “runner” (PyInstaller + mypyc), which drives devices via a **bundled Appium/Node** runtime.

```
┌─────────────────────────────────────────────────────────────┐
│  noqa.app (macOS, Apple Silicon + Intel)                    │
│                                                             │
│  Tauri 2 (Rust)  ──webview──►  Vite-built React UI          │
│       │                         assets/index-*.js|.css      │
│       │                                                     │
│       ├── spawns / embeds ──►  noqa_runner (PyInstaller)    │
│       │                         FastAPI + CLI (Click/Typer) │
│       │                         domains: devices, testing,  │
│       │                         builds, ios/WDA, auth…      │
│       │                              │                      │
│       │                              ▼                      │
│       └── Resources/bundled-runtime  Node 22 + Appium 2.19  │
│              └── XCUITest / UiAutomator2 on device          │
└─────────────────────────────────────────────────────────────┘
          │ HTTPS
          ▼
   api.noqa.ai · Supabase · Sentry · cdn.noqa.ai (updates)
```

## What each public surface is

| Surface | Stack / role |
|--------|----------------|
| [noqa.ai](https://noqa.ai/) | Marketing site (Astro assets under `/_astro/…`), Cloudflare |
| [docs.noqa.ai](https://docs.noqa.ai) | [Mintlify](https://mintlify.com) on Vercel |
| [github.com/noqa-ai/noqa](https://github.com/noqa-ai/noqa) | README + `skills/noqa-testing` + assets — **not** app source |
| Mac DMG / `.app` | Product binary (this folder) |
| `cdn.noqa.ai/app/macos/releases/…` | Tauri updater manifests + `noqa.app.tar.gz` |

## Desktop app (Tauri)

Evidence from `Contents/MacOS/app` and `Info.plist`:

- **Framework:** Tauri 2 (`tauri-plugin-updater/2.9.0`, plugins `dialog`, `fs`, `log`, `shell`, `single-instance`, `updater`)
- **Bundle ID:** `com.codeandbicycles.noqa` (company: Code & Bicycles)
- **Version:** `2.0.12` (matches CDN `latest.json`, pub date 2026-07-16)
- **Deep link:** `noqa://`
- **Frontend build:** Vite content-hashed bundles (`/assets/index-D9OgbXgj.js`, `index-BXg2p7-R.css`, etc.) with React strings in the binary
- **Backend services referenced in binary:** `https://api.noqa.ai`, `https://r.noqa.ai`, Supabase (`*.supabase.co`), Sentry (`*.sentry.io`)
- **Auto-update:** Tauri updater → `https://cdn.noqa.ai/app/macos/releases/latest/latest.json` (and `latest-rc.json`)

Typical private repo layout (inferred, not public):

```
apps/desktop/          # or similar
  src-tauri/           # Rust, tauri.conf.json, cargo
  src/                 # React + Vite
  package.json
```

## Local runner (Python)

`Contents/Resources/runner/{arm64,x86_64}/noqa_runner` is a **PyInstaller** onefile/onedir-style build (MEI trailer, `pyi_rth_*`), targeting **CPython 3.12**, with app logic largely **mypyc**-compiled.

**Architecture (from embedded module names):** hexagonal / DDD-ish Python package `noqa_runner`:

- `domains/` — `apps`, `auth`, `builds`, `devices` (android/ios adapters), `environment` (+ skill install), `ios` (signing, WDA, Xcode), `testing` (local execution, runs, analytics)
- `interfaces/api/` — FastAPI routes/schemas for apps, auth, builds, devices, environment, proxy, runner, runs, skill, testing
- `interfaces/cli/` — CLI matching public docs (`action`, `devices`, `cases`, `builds`, `inspect`/`screen`, etc.) via **Click** / **Typer**
- `shared/adapters/` — `appium`, `agent`, `api`, `fs`, `runner_api`, `system_commands`

**Bundled Python deps (dist-info samples):** FastAPI 0.139.2, Pydantic 2.12.5, uvicorn, Appium-Python-Client 5.3.1, numpy, boto3/botocore, aiohttp, structlog, click, …

Ship path also includes the public skill: `_internal/skills/noqa-testing` (same content as GitHub).

## Device runtime

`Contents/Resources/bundled-runtime/{arm64,x86_64}/version.json`:

```json
{
  "node_version": "22.22.0",
  "appium_version": "2.19.0",
  "architecture": "arm64",
  "created_at": "2026-07-16T19:02:38Z"
}
```

Matches product claims: Appium with XCUITest (iOS) / UiAutomator2 (Android). Runtime is vendored into the app so users don’t install Appium globally.

## Packaging & release

1. Build React UI with Vite → embed in Tauri
2. Build `noqa_runner` with PyInstaller (+ mypyc) per arch
3. Bundle Node + Appium into `Resources/bundled-runtime`
4. `tauri build` → `.app` (universal or dual-arch layout)
5. Package DMG (custom `.background/dmg-background.tiff` drag-to-Applications style)
6. Publish Tauri updater artifact: `cdn.noqa.ai/.../noqa.app.tar.gz` + signed `latest.json`

## What is *not* in the DMG / public repo

- Original TypeScript/Rust/Python source trees
- `tauri.conf.json` / `Cargo.toml` / `pyproject.toml` as editable projects
- Cloud agent / training stack behind “noqa agent” (server-side at `api.noqa.ai`)

## How this relates to “source in this directory”

You have the **distribution**, not the **monorepo**. Closest “source-like” artifacts here:

- Bundled skill markdown under the runner
- Reconstructable API/CLI surface from `noqa_runner.*` module names
- Minified Vite JS inside the Tauri binary (not practical as a project)

To develop against noqa as a user: install the app + CLI (per [docs](https://docs.noqa.ai)); to fork the product itself you’d need their private repos.
