# macOS desktop release (bundled runner)

## Goal

Ship a downloadable **unsigned** Apple Silicon DMG where Yoqa Desktop starts its local Hono runner without a monorepo checkout.

## Plan summary

- Compile `services/runner` with `bun build --compile` into `apps/desktop/resources/runner/yoqa-runner`
- Compile CLI `packages/cli/src/main.ts` → `apps/desktop/resources/runner/yoqa`
- **Adhoc-sign both Mach-Os on macOS** after compile (`codesign --sign -`). Bun appends bytecode after the linker signature, which Apple Silicon AMFI treats as modified code and **SIGKILLs** (`killed`, exit 137) — even `yoqa --version`.
- Pack `packages/skill/yoqa-testing` → `apps/desktop/resources/skills/yoqa-testing.tar.gz`
- Electrobun `preBuild` + `copy` + `asarUnpack` for runner, CLI, and skill archive (zig-asar needs exact file paths — globs like `runner/**` do **not** unpack)
- Sidecar prefers `Contents/Resources/app.asar.unpacked/runner/yoqa-runner`; falls back to monorepo `bun run` for `electrobun dev`
- Settings → CLI & Agents resolves packaged `runner/yoqa` + skill archive (no monorepo checkout)
- Tag `v*` triggers GitHub Actions on `macos-15` → stable Electrobun DMG → GitHub Release
- **Yoqa updates** ([ADR-0013](../adr/0013-yoqa-updates-from-github-releases.md)): `release.baseUrl` is the repository's GitHub Releases `latest/download` URL and `generatePatch` is on, so every build diffs against the latest published release and emits one delta patch from it. A stable `v*` tag build fails without that patch; PR and manual runs still upload their files without one. Prerelease tags (`v*-*`) build with `--env=canary` so a beta never "updates" down to the older stable release.
- Rejected: a separate patch-check shell step per job. The channel and file-name rules live in one tested helper the workflow calls, so the two build jobs and `publish` can't drift apart.

Rejected for v0.1.0: shipping Appium/Node inside the DMG; Apple codesign/notarize; Intel x64.

## What shipped

- [`apps/desktop/scripts/build-runner-sidecar.ts`](../../apps/desktop/scripts/build-runner-sidecar.ts) — compile step (Bun plugin rewrites WebdriverIO’s dynamic `import(automationProtocol || "webdriver")` to a literal so the packaged binary embeds `webdriver`; macOS adhoc re-sign after compile)
- [`apps/desktop/src/bun/features/macos-adhoc-sign.ts`](../../apps/desktop/src/bun/features/macos-adhoc-sign.ts) — shared `codesign --sign -` helper; also repairs packaged CLI on Install and packaged runner on spawn
- [`apps/desktop/electrobun.config.ts`](../../apps/desktop/electrobun.config.ts) — `preBuild`, `copy`, `asarUnpack`; `release.baseUrl` = `https://github.com/Aris-ngoy/qa-agent/releases/latest/download`, `generatePatch: true`
- [`apps/desktop/src/bun/features/release-artifacts.ts`](../../apps/desktop/src/bun/features/release-artifacts.ts) (tested) + [`apps/desktop/scripts/release-artifacts.ts`](../../apps/desktop/scripts/release-artifacts.ts) — picks the channel from the run's ref (`stable` for `v*` tags, PRs and branch runs; `canary` for `v*-*` tags), checks each platform's artifacts after the build, and hands the upload list, the release file list and the install names to the workflow. Only a stable tag build requires the patch. It keys on the ref, not the event, because `publish` runs for any `refs/tags/v*` ref, so a manual run started on a tag is held to the same rule.
- [`apps/desktop/src/bun/features/runner-sidecar/index.ts`](../../apps/desktop/src/bun/features/runner-sidecar/index.ts) — packaged-first launch; replaces stale loopback runners whose `/health` version ≠ desktop (see [runner-sidecar-version-gate.md](./runner-sidecar-version-gate.md))
- WDA icon embedded via Bun `with { type: "file" }` so compiled runner keeps branding (write bytes, never `copyFile` from `/$bunfs`)
- Scripts: `bun run --filter @yoqa/desktop build:release`, root `desktop:release`
- Workflow: [`.github/workflows/release-desktop.yml`](../../.github/workflows/release-desktop.yml) (`build-macos` job; Windows lane in [windows-release.md](./windows-release.md)) — install/verify boilerplate plus `generate_release_notes: true` (PR changelog appended). See [release-notes.md](./release-notes.md).

Expected artifacts (stable arm64):

| File | Role |
|------|------|
| `apps/desktop/artifacts/stable-macos-arm64-yoqa.dmg` | Primary download |
| `apps/desktop/artifacts/stable-macos-arm64-yoqa.app.tar.zst` | Yoqa update full download / archive |
| `apps/desktop/artifacts/stable-macos-arm64-update.json` | Channel metadata (`version`, `hash`) the updater checks |
| `apps/desktop/artifacts/stable-macos-arm64-<previous-hash>.patch` | Yoqa update delta patch from the previous release. `<previous-hash>` is the `hash` in the latest published `stable-macos-arm64-update.json` (for example `stable-macos-arm64-1dkljki1vkqlu.patch` while v1.0.7 is latest) |

A prerelease tag (`v*-*`) builds as canary instead: `canary-macos-arm64-yoqa-canary.dmg`, `canary-macos-arm64-yoqa-canary.app.tar.zst` and `canary-macos-arm64-update.json`, with no patch. GitHub's `latest/download` never serves a prerelease, and the stable app only asks for `stable-…` names, so a canary build is never what a stable install downloads. What canary changes, from Electrobun 1.18.1's build and updater source:

- The app is `yoqa-canary.app`, so it installs beside `yoqa.app`.
- `CFBundleIdentifier` stays `ai.yoqa.app`. Electrobun doesn't add the channel to the identifier.
- Electrobun's app-data folder gains the channel: `~/Library/Application Support/ai.yoqa.app/canary/` vs `…/stable/` (Windows: `%LOCALAPPDATA%\ai.yoqa.app\canary\`).
- Yoqa's own data does not: both apps use `~/.yoqa` and the runner on port 7420, so quit one before opening the other. The release notes say so for prereleases.
- It never updates itself: `latest/download/canary-macos-arm64-update.json` never exists, so Yoqa doesn't check for a Yoqa update on the canary channel at all ([yoqa-update.md](yoqa-update.md)).

## How to verify

```bash
bun run desktop:release
# copy the .app outside the repo, e.g.:
cp -R apps/desktop/build/stable-macos-arm64/yoqa.app /tmp/yoqa.app
open /tmp/yoqa.app
curl -s http://127.0.0.1:7420/health
codesign --verify apps/desktop/resources/runner/yoqa
apps/desktop/resources/runner/yoqa --version
```

Cut a release (**repository owner only** — `v*` tags are restricted by ruleset; authorize step + **`release` Environment** approval are both required):

```bash
git tag v0.3.4
git push origin v0.3.4
# Actions → Release Desktop → approve the "release" environment deployment
```

A manual run (Actions → Release Desktop → Run workflow) builds stable and should upload four files per platform, the `.patch` included. If Electrobun can't diff (latest release unreachable, bsdiff failed), the run still uploads the other three and the "Collect release files" step leaves a warning. The same miss on a stable tag build fails the job, so nothing is published.

Codesign/notarize secrets (when added): [release-signing-secrets.md](./release-signing-secrets.md).

### First release with the update URL

Every install from before this change has an empty `baseUrl` and never sees a Yoqa update. The first release built with the URL must start its notes, above the install steps, with:

> **Download this release by hand one last time.** From this version on, Yoqa Desktop updates itself from GitHub Releases. Versions before it can't, so install this one from the files below.

Edit the published notes with `gh release edit <tag> --notes-file -` (see [release-notes.md](./release-notes.md)). Later releases don't need it.

### Rolling back: roll forward

Yoqa updates are matched by `hash`, not by version, and each release carries only the patch from the one before it. To back out a bad release, tag a new one (revert, bump `app.version`, tag). Installs on the bad release get a patch to the fix, and older installs get the full download.

Deleting the latest release is for emergencies only (for example a release that must stop spreading right now). It costs:

- Every install on the deleted version sees the previous release's different hash and "updates" back to it with the full `.tar.zst`, since the previous release has no patch from the deleted one.
- The patch chain breaks: the next release diffs against the previous release, so installs that took the deleted one get the full download again.
- Anyone holding a link to the deleted release's files gets a 404.

After an emergency delete, tag the fix as soon as possible.

Gatekeeper: unsigned downloads get `com.apple.quarantine`, and recent macOS shows **“yoqa” is damaged…** instead of the old unidentified-developer dialog. Clear it before first launch:

```bash
xattr -cr /Applications/yoqa.app
open /Applications/yoqa.app
```

## Follow-ups

- Apple codesign + notarize secrets
- `macos-x64` matrix build
- ~~Set `release.baseUrl` to the GitHub Releases download URL for Electrobun auto-update~~ Done: `latest/download` with `generatePatch` on ([ADR-0013](../adr/0013-yoqa-updates-from-github-releases.md)). The in-app updater is [#472](https://github.com/Aris-ngoy/qa-agent/issues/472).
- Confirm on the first prerelease build that canary installs beside stable with the paths above.
