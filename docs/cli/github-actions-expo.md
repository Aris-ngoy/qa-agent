# GitHub Actions + Expo demo for `@yoqa/cli`

## Goal

Dogfood unpublished `@yoqa/cli` against a real Expo Android binary on GitHub-hosted Ubuntu (KVM emulator), without an AI provider.

## Plan summary

- Fixture app lives at [`examples/expo-demo`](../../examples/expo-demo) — **not** a Bun workspace (npm lockfile, Expo toolchain stays out of Turbo / `lint:ci`).
- CI builds `@yoqa/runner` + `@yoqa/cli` from the same commit and puts `node packages/cli/dist/main.js` on `PATH` as `yoqa`.
- Smoke uses the device-connector surface only: `yoqa assert` and `yoqa action --label` ([`yoqa/ci-smoke.sh`](../../examples/expo-demo/yoqa/ci-smoke.sh)). No `--description`, no `yoqa runs create --mode agent`.
- **Android only** on `ubuntu-latest` + KVM (`x86_64`). GitHub-hosted macOS has no HVF (ARM emulator exits with `HV_UNSUPPORTED`). iOS Simulator CI is a follow-up. Path-filtered + `workflow_dispatch`. **Not** a required status check.
- Native Android is generated in CI with **Expo CLI**: `npx expo prebuild --platform android` then `npx expo run:android --device <AVD name>` (`adb emu avd name`, not the `emulator-5554` serial). `android/` stays gitignored.
- Rejected for this slice: separate public customer repo, catalog/`yoqa runs create`, making the job required.

## What shipped

- Expo SDK 57 TypeScript app, bundle / application id `ai.yoqa.demo`, Home + Greeting screens with `accessibilityLabel`.
- [`.github/workflows/demo-expo-e2e.yml`](../../.github/workflows/demo-expo-e2e.yml) — `npx expo prebuild --platform android` then `npx expo run:android` on Ubuntu + KVM (API 35 x86_64).
- Public Mintlify CI section + local-testing table updated to point at this example (hosted **device farm** remains “not yet”).

Customer-equivalent (published CLI, not this repo’s workflow):

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: "1.2.23"
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- run: npm i -g @yoqa/cli
- run: yoqa health && yoqa runtime ensure
```

Then install a build, `yoqa devices connect`, and run `examples/expo-demo/yoqa/ci-smoke.sh`.

## How to verify

1. Local: `cd examples/expo-demo && npm ci && npx expo prebuild --platform android && npx expo run:android --variant release --no-bundler`, then `yoqa health`, `yoqa devices connect … --platform android --app-package ai.yoqa.demo`, `./yoqa/ci-smoke.sh`.
2. `bun run lint:ci` and `bun run test` still ignore the Expo tree.
3. GitHub: Actions → **Demo Expo E2E** → Run workflow. On failure, download the `yoqa-expo-demo-android-failure` artifact.

## Follow-ups

- `yoqa apps create` CLI + catalog / `yoqa runs create --mode script`
- Agent mode in CI (provider secrets)
- Composite action `yoqa/setup`
- Making this workflow a required check
- Extracting a standalone public example repo
- iOS Simulator job (`macos-15` + `expo run:ios`) — blocked on Xcode SPM resolve in CI
