# Windows tool discovery (Bun, adb, PATH)

## Goal

Make the CLI and runner find their host tools on Windows. Two bugs came from the same POSIX-only assumptions:

- [#334](https://github.com/Aris-ngoy/qa-agent/issues/334): `yoqa` could not autostart the runner ("Could not find Bun") although `%USERPROFILE%\.bun\bin\bun.exe` was installed.
- [#335](https://github.com/Aris-ngoy/qa-agent/issues/335): `yoqa doctor` always reported "adb not found", even with `ANDROID_HOME` set and `platform-tools` on `PATH`.

## Plan summary

- Build and rewrite `PATH` with the platform delimiter (`;` on Windows). Before this change, `ensureHostToolPath()` split the Windows `PATH` on `:` and wrote the result back to `process.env.PATH`, which dropped every system entry from the runner's environment.
- Find binaries without spawning POSIX tools. The runner uses `Bun.which()` (PATHEXT-aware) and `existsSync` in place of `which` and `test -x`. The CLI runs on Node, so it calls `where` on Windows and `which` elsewhere.
- Add `.exe` to well-known binary paths on Windows (`bun.exe`, `adb.exe`, `emulator.exe`, `yoqa-runner.exe`). Skip the Homebrew dirs there.
- Path helpers take a `platform` argument and use `node:path`'s `win32`/`posix` modules, so tests cover both platforms on any host.
- Rejected: skipping the `PATH` rewrite entirely on win32. The per-user dirs (`~/.bun/bin`, `~/.local/bin`, agent CLIs) still help GUI-launched processes there.

## What shipped

- **CLI** (`packages/cli/src/ensure-runner.ts`): exports `bunCandidates()` and `pathWithHostTools()`, both platform-aware. `defaultWhich` uses `where` on Windows and splits its output on CRLF. `packagedYoqaRunnerCandidates()` looks for `yoqa-runner.exe` on Windows.
- **Runner `PATH`** (`android-toolchain/host-path.ts`): adds `pathDelimiter()` and `prependPathEntries()`. `pathWithHostTools()` and `pathWithAndroidSdk()` now go through them.
- **Android SDK** (`android-toolchain/android-sdk.ts`): adds `androidSdkToolPath()` for SDK binaries, with `.exe` on Windows. `defaultAndroidSdkRoot`, `defaultJavaHomeCandidates` and `androidSdkBinDirs` join paths for the target platform.
- **Devices** (`devices/application.ts`): `resolveTool()` checks that absolute candidates exist and resolves bare names with `Bun.which`. Before this change, bare `adb` only matched a file named `./adb` in the working directory.
- **Desktop dev script** (`apps/desktop/package.json`): `concurrently` runs its commands through `cmd.exe` on Windows, which rejects `YOQA_REPO_ROOT=… electrobun dev`. The app half now lives in a `dev:app` script that `concurrently` calls with `bun run dev:app`. `bun run` uses Bun's cross-platform shell, so the env assignment works everywhere.
- **Doctor** (`doctor/application.ts`): `which()` is now `Bun.which`. The ADB probe falls back to `ANDROID_HOME`/`ANDROID_SDK_ROOT` or the platform-default SDK, where it used to fall back to a hardcoded macOS path.

## How to verify

- `bun test packages/cli/src/ensure-runner.test.ts services/runner/src/domains/android-toolchain` covers the Windows cases: the `;` delimiter, `.exe` candidates and backslash paths.
- On Windows with Bun and platform-tools installed, quit any running runner, then:
  - `yoqa health` starts the runner from `%USERPROFILE%\.bun\bin\bun.exe`.
  - `yoqa doctor --json` reports `adb-devices` as `pass`.

## Follow-ups

- `providers/drivers/probe.ts` still lists POSIX-style `knownHomeBinCandidates` (no `.exe`). On Windows it relies on `Bun.which` and the fixed `PATH`.
- Some CLI `resolveRunnerLaunch` tests assert POSIX paths built with the native `join`, so they fail when run on a Windows host. They pass on Linux CI and failed on Windows before this change too.
