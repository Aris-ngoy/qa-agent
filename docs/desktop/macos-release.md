# macOS desktop release (bundled runner)

## Goal

Ship a downloadable **unsigned** Apple Silicon DMG where YoQA Desktop starts its local Hono runner without a monorepo checkout.

## Plan summary

- Compile `services/runner` with `bun build --compile` into `apps/desktop/resources/runner/yoqa-runner`
- Electrobun `preBuild` + `copy` + `asarUnpack: ["runner/yoqa-runner", …]` (zig-asar needs an exact file path — `runner/**` does **not** unpack)
- Sidecar prefers `Contents/Resources/app.asar.unpacked/runner/yoqa-runner`; falls back to monorepo `bun run` for `electrobun dev`
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

Cut a release:

```bash
git tag v0.3.1
git push origin v0.3.1
# watch Actions → Release macOS
```

Gatekeeper: unsigned downloads get `com.apple.quarantine`, and recent macOS shows **“yoqa” is damaged…** instead of the old unidentified-developer dialog. Clear it before first launch:

```bash
xattr -cr /Applications/yoqa.app
open /Applications/yoqa.app
```

## Follow-ups

- Apple codesign + notarize secrets
- `macos-x64` matrix build
- Package CLI + skill into Resources for Settings installs without a checkout
- Set `release.baseUrl` to the GitHub Releases download URL for Electrobun auto-update
- Optional: ship a Node/npm sidecar so Appium install works with zero host Node install
