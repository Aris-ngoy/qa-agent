# YoqaRunner in the packaged desktop app

## Goal

In the 1.0.1 desktop app, every iPhone connect failed with "YoqaRunner could not be built for team …: '/native/yoqa-runner/YoqaRunner.xcodeproj' does not exist", followed by advice to check the signing team. Signing was fine. The runner builds `YoqaRunner` from its Xcode project (see [yoqa-runner-status.md](./yoqa-runner-status.md)), and the packaged app had no copy of that project. The goal: let the packaged runner build `YoqaRunner`, and say so plainly when the project is missing.

## Plan summary

- **Cause.** The packaged runner is a `bun build --compile` binary. There, `import.meta.dir` is Bun's virtual filesystem, so `../../../../../native/yoqa-runner` resolved to `/native/yoqa-runner`. The desktop app shipped the runner, the CLI and the skill archive, but not the runner's Swift sources. From a checkout (`bun dev`) the relative path is real, which is why only the packaged app failed.
- **Ship the sources as an archive beside the runner binary.** This matches the skill archive. Rejected: copying the project folder into the bundle and building it there. `xcodebuild` would work inside the signed, possibly read-only `.app`. Rejected: embedding each file in the compiled binary, since the file list would have to be kept by hand.
- **Unpack once per archive.** The archive is unpacked to `~/.yoqa/yoqa-runner/source/<archive sha256>`, then renamed into place so two runners cannot leave a half-unpacked copy. The build cache is keyed by source content, so a new app version with the same sources reuses the old build.
- **A missing project is not a signing problem.** `prepareYoqaRunner` checks for `YoqaRunner.xcodeproj` before choosing a team or running `xcodebuild`.

## What shipped

- [`build-runner-sidecar.ts`](../../apps/desktop/scripts/build-runner-sidecar.ts) packs `YoqaRunner`, `YoqaRunnerUITests`, `Sources` and `YoqaRunner.xcodeproj` into `resources/runner/yoqa-runner-src.tar.gz` (about 34 KB), without `xcuserdata`, `.DS_Store` or AppleDouble files. [`electrobun.config.ts`](../../apps/desktop/electrobun.config.ts) ships it, unpacked from the asar, beside `runner/yoqa-runner`.
- [`yoqa-runner.ts`](../../services/runner/src/domains/devices/yoqa-runner.ts): `resolveYoqaRunnerProject` picks `YOQA_RUNNER_PROJECT`, then the checkout when it has the Xcode project, then the archive beside `process.execPath`. `prepareYoqaRunner` fails with "YoqaRunner's Xcode project is missing from this install (looked in …). Reinstall yoqa, or set YOQA_RUNNER_PROJECT to a native/yoqa-runner checkout."

## How to verify

1. `bun test services/runner/src/domains/devices/yoqa-runner.test.ts`
2. `bun run --filter @yoqa/desktop build:runner`, then `tar -tzf apps/desktop/resources/runner/yoqa-runner-src.tar.gz` lists the four entries.
3. Install the packaged app, cable an unlocked iPhone and connect. The runner builds from `~/.yoqa/yoqa-runner/source/<hash>`, and the connect gets past the build.

## Follow-ups

- Each app build makes a new archive (gzip stores a timestamp), so `~/.yoqa/yoqa-runner/source/` keeps one small copy per installed version. Prune old copies.
- A runner started from the npm CLI package still has no `native/` sources. It now gets the missing-project error, not a fix.
