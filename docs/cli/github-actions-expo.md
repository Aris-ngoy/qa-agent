# GitHub Actions + Expo demo for `@yoqa/cli`

## Goal

Dogfood unpublished `@yoqa/cli` against a real Expo binary on GitHub-hosted runners (iOS Simulator + Android Emulator), without an AI provider.

## Plan summary

- Fixture app lives at [`examples/expo-demo`](../../examples/expo-demo) — **not** a Bun workspace (npm lockfile, Expo toolchain stays out of Turbo / `lint:ci`).
- CI builds `@yoqa/runner` + `@yoqa/cli` from the same commit and puts `node packages/cli/dist/main.js` on `PATH` as `yoqa`.
- Smoke uses a checked-in CaseScript ([`yoqa/smoke.yoqa.json`](../../examples/expo-demo/yoqa/smoke.yoqa.json)): `assert` + `tap --label` replayed with `yoqa runs create DEMO --cases 1 --mode script` (no `--description`, no agent). [`yoqa/ci-smoke.sh`](../../examples/expo-demo/yoqa/ci-smoke.sh) is the same steps on the device-connector CLI for local debugging.
- Catalog runs write the same HTML as desktop **Export HTML**. Jobs upload `yoqa-expo-demo-*-report` (open the **run** summary → Artifacts, not the job log).
- **iOS** on `macos-26` + Xcode **26.4.1** (Expo SDK 57 needs 26.4+; 26.5+ can fail ExpoModulesJSI SPM with an empty “Could not resolve package dependencies”). Simulator connect allows **600s** for the first WebDriverAgent compile; CI precompiles WDA in parallel with `expo run:ios` and caches `~/.yoqa/wda-sim`. **Android** on `ubuntu-latest` + KVM (`x86_64` API 34). Path-filtered + `workflow_dispatch`. **Not** a required status check.
- Native projects are generated in CI with **Expo CLI**: `npx expo prebuild` then `npx expo run:ios` / `npx expo run:android`. `ios/` and `android/` stay gitignored.
- Rejected for this slice: separate public customer repo, making the job required.

## What shipped

- Expo SDK 57 TypeScript app, bundle / application id `ai.yoqa.demo`, Home + Greeting screens with `accessibilityLabel`.
- [`.github/workflows/demo-expo-e2e.yml`](../../.github/workflows/demo-expo-e2e.yml) — parallel iOS Simulator + Android Emulator jobs.
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

Then install a build, `yoqa devices connect`, and run `examples/expo-demo/yoqa/seed-catalog.sh` followed by `yoqa runs create DEMO --cases 1 --mode script --wait` (or `./yoqa/ci-smoke.sh` for connector-only).

## How to verify

1. Local Android: `cd examples/expo-demo && npm ci && npx expo prebuild --platform android && npx expo run:android --variant release --no-bundler`, then `yoqa health`, `yoqa devices connect … --platform android --app-package ai.yoqa.demo`, `./yoqa/ci-smoke.sh`.
2. Local iOS: same with `npx expo prebuild --platform ios` and `npx expo run:ios --configuration Release --no-bundler`, then `yoqa devices connect … --platform ios --bundle-id ai.yoqa.demo`.
3. `bun run lint:ci` and `bun run test` still ignore the Expo tree.
4. GitHub: Actions → **Demo Expo E2E** → Run workflow. Download `yoqa-expo-demo-*-report` from the run Artifacts section for the HTML report.

## Follow-ups

- Catalog import/export so CI does not hand-seed `~/.yoqa/yoqa.db`
- Agent mode in CI (provider secrets)
- Making this workflow a required check
- Extracting a standalone public example repo
