# Windows desktop release (experimental)

## Goal

Ship an unsigned Windows x64 installer on the same `v*` GitHub Release as the macOS DMG, built from the same Electrobun app and bundled runner.

## Plan summary

- One workflow, [`.github/workflows/release-desktop.yml`](../../.github/workflows/release-desktop.yml) (renamed from `release-macos.yml`): `authorize` → `build-macos` + `build-windows` in parallel → one `publish` job. The build jobs upload workflow artifacts and `publish` downloads both, so it creates the Release once with one body.
- Rejected: a second tag-triggered `release-windows.yml`. Both workflows would race to create the same Release, and whichever ran last would overwrite the other's `body`.
- `build-windows` runs `bun run --filter @yoqa/desktop build:release` natively on `windows-2022`. Electrobun cross-builds aren't used, and the `preBuild` sidecar compile has to run on the target OS.
- `publish` needs both builds, so a broken Windows build holds the macOS release. To check the Windows lane before tagging, run the workflow manually or let a packaging PR trigger it. Both are build-only runs.
- Rejected for now: code signing (SmartScreen warns), arm64 Windows, and porting the runner's POSIX-only paths (see Follow-ups).

## What shipped

- `executableFileName()` in [`packaged-resources.ts`](../../apps/desktop/src/bun/features/packaged-resources.ts): `yoqa-runner.exe` / `yoqa.exe` on Windows, unchanged elsewhere. It is used by:
  - [`build-runner-sidecar.ts`](../../apps/desktop/scripts/build-runner-sidecar.ts): compile output names. On Windows, archives are packed with the system bsdtar (`%SystemRoot%\System32\tar.exe`), because Git's GNU tar can sit first on PATH and treats `C:\…` as a remote host.
  - [`electrobun.config.ts`](../../apps/desktop/electrobun.config.ts): `copy` and `asarUnpack` entries. zig-asar unpacks exact paths only.
  - Runner sidecar and the CLI lookup, so the packaged app finds the `.exe` binaries.
- Runner sidecar PATH now joins with `path.delimiter` (`;` on Windows) instead of `:`.
- Workflow triggers: `v*` tag (build + publish), `workflow_dispatch` and `pull_request` on packaging files (build only; the owner-only gate is skipped for PRs because they publish nothing and use no secrets).

Expected artifacts (stable x64):

| File | Role |
|------|------|
| `apps/desktop/artifacts/stable-win-x64-yoqa-Setup.zip` | Primary download (`yoqa-Setup.exe` + `.installer/` payload) |
| `apps/desktop/artifacts/stable-win-x64-yoqa.tar.zst` | Update / archive |
| `apps/desktop/artifacts/stable-win-x64-update.json` | Channel metadata |

## How to verify

- PR or manual run: Actions → **Release Desktop** → both build jobs green, `publish` skipped, `desktop-win-x64` artifact holds the three files above.
- On a Windows x64 machine: extract the zip, run `yoqa-Setup.exe`, launch Yoqa, then `curl http://127.0.0.1:7420/health`.
- Tag release: same as macOS ([macos-release.md](./macos-release.md)). The Release lists both the macOS and the Windows files.

## Follow-ups

- Runner on Windows: the `which` fallback in `services/runner/src/domains/providers/drivers/probe.ts`. The doctor probes, PATH joining and the `lsof` port cleanup are fixed; see [windows-tool-discovery.md](../architecture/windows-tool-discovery.md).
- Settings → CLI & Agents installer: uses `~/Library/Application Support`, `~/.local/bin` symlinks and a `:` PATH check (`cli-environment/index.ts`).
- Authenticode signing, and a `win-arm64` build.
