# macOS desktop release (bundled runner)

## Goal

Ship a downloadable **unsigned** Apple Silicon DMG where Yoqa Desktop starts its local Hono runner without a monorepo checkout.

## Plan summary

- Compile `services/runner` with `bun build --compile` into `apps/desktop/resources/runner/yoqa-runner`
- Compile CLI `packages/cli/src/main.ts` → `apps/desktop/resources/runner/yoqa`
- Pack `packages/skill/yoqa-testing` → `apps/desktop/resources/skills/yoqa-testing.tar.gz`
- Electrobun `preBuild` + `copy` + `asarUnpack` for runner, CLI, and skill archive (zig-asar needs exact file paths — globs like `runner/**` do **not** unpack)
- Sidecar prefers `Contents/Resources/app.asar.unpacked/runner/yoqa-runner`; falls back to monorepo `bun run` for `electrobun dev`
- Settings → CLI & Agents resolves packaged `runner/yoqa` + skill archive (no monorepo checkout)
- Tag `v*` triggers GitHub Actions on `macos-14` → stable Electrobun DMG → GitHub Release

Rejected for v0.1.0: shipping Appium/Node inside the DMG; Apple codesign/notarize; Intel x64.

## What shipped

- [`apps/desktop/scripts/build-runner-sidecar.ts`](../../apps/desktop/scripts/build-runner-sidecar.ts) — compile step
- [`apps/desktop/electrobun.config.ts`](../../apps/desktop/electrobun.config.ts) — `preBuild`, `copy`, `asarUnpack`, `generatePatch: false`
- [`apps/desktop/src/bun/features/runner-sidecar/index.ts`](../../apps/desktop/src/bun/features/runner-sidecar/index.ts) — packaged-first launch
- WDA icon embedded via Bun `with { type: "file" }` so compiled runner keeps branding
- Scripts: `bun run --filter @yoqa/desktop build:release`, root `desktop:release`
- Workflow: [`.github/workflows/release-macos.yml`](../../.github/workflows/release-macos.yml)

Expected artifacts (stable arm64):

| File | Role |
|------|------|
| `apps/desktop/artifacts/stable-macos-arm64-yoqa.dmg` | Primary download |
| `apps/desktop/artifacts/stable-macos-arm64-yoqa.app.tar.zst` | Update / archive |
| `apps/desktop/artifacts/stable-macos-arm64-update.json` | Channel metadata |

## How to verify

```bash
bun run desktop:release
# copy the .app outside the repo, e.g.:
cp -R apps/desktop/build/stable-macos-arm64/yoqa.app /tmp/yoqa.app
open /tmp/yoqa.app
curl -s http://127.0.0.1:7420/health
```

Cut a release (**repository owner only** — `v*` tags are restricted by ruleset; authorize step + **`release` Environment** approval are both required):

```bash
git tag v0.3.4
git push origin v0.3.4
# Actions → Release macOS → approve the "release" environment deployment
```

Codesign/notarize secrets (when added): [release-signing-secrets.md](./release-signing-secrets.md).

Gatekeeper: unsigned downloads get `com.apple.quarantine`, and recent macOS shows **“yoqa” is damaged…** instead of the old unidentified-developer dialog. Clear it before first launch:

```bash
xattr -cr /Applications/yoqa.app
open /Applications/yoqa.app
```

## Follow-ups

- Apple codesign + notarize secrets
- `macos-x64` matrix build
- Set `release.baseUrl` to the GitHub Releases download URL for Electrobun auto-update
- Optional: ship a Node/npm sidecar so Appium install works with zero host Node install
