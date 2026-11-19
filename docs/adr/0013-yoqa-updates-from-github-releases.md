---
status: accepted
---

# Yoqa updates are served from GitHub Releases `latest/download`

Yoqa Desktop updates itself with Electrobun's updater. `release.baseUrl` is `https://github.com/<owner>/<repo>/releases/latest/download`, the same GitHub Release that `release-desktop.yml` already publishes, with `generatePatch` on. There is no new hosting and no new secret, and the owner-only `release` Environment stays the only way a Yoqa update reaches installs.

- **Only N-1 gets a patch.** Electrobun builds one `bsdiff` patch per release, from the release just before it, and each patch lives in its own GitHub Release. `latest/download` serves only the newest release's files. An install one version behind gets the small patch; an install further behind gets the full `.tar.zst`. Electrobun falls back to that by itself.
- **No prerelease channel.** `latest/download` never serves a prerelease. Prerelease tags are built `--env=canary`, so they install beside the stable app and never update. They are not built as stable: a stable-channel beta would see the older stable release's different hash and "update" down to it.
- **Roll forward, don't delete.** Updates are matched by hash, not by version. Deleting the latest release makes every install "update" back to the previous one in full and breaks the patch chain, so a bad release is fixed by tagging a new one. Deleting is kept for emergencies only.
- **Trust.** Hashes come from the same `update.json` the app downloads, so integrity rests on GitHub HTTPS and on who can publish a release. Checking signatures waits on Apple codesign and notarization (`docs/desktop/release-signing-secrets.md`).

## Considered options

- **A flat bucket (R2 or S3) holding every patch and channel:** rejected for now. It would make long patch chains and a canary channel that updates possible, but it needs infrastructure and a write credential in the `release` Environment. That isn't worth it while installs check on launch and are rarely more than one version behind.

## Consequences

- `baseUrl` is baked into every install. Moving to another host later strands every install on this URL behind one more download by hand, unless GitHub keeps serving a release that points to the new host.
- Every install from before the first release with this `baseUrl` has an empty `baseUrl` and never sees a Yoqa update. That release is downloaded by hand, once, and its notes say so.
