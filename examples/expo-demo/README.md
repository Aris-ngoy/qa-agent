# Yoqa Expo demo

Minimal Expo app used to dogfood [`@yoqa/cli`](../../packages/cli) in GitHub Actions. Bundle / application id is `ai.yoqa.demo`.

This package is **not** a Bun workspace. Use npm here; keep Expo’s toolchain out of the monorepo Turbo graph.

## Screens

| Screen | Visible text | Accessibility labels |
|--------|----------------|----------------------|
| Home | `Yoqa Demo`, `Count: N` | `Increment`, `Decrement`, `Open greeting` |
| Greeting | `Hello, {name}` after submit | `Name`, `Submit` |

## Local

```bash
cd examples/expo-demo
npm ci
npx expo prebuild --platform android   # or --platform ios
npx expo run:android --variant release --no-bundler
# npx expo run:ios --configuration Release --no-bundler
```

`expo prebuild` generates `android/` / `ios/` (gitignored). `expo run:*` then builds, installs, and launches. CI uses the same Expo CLI commands.

Then, from a repo checkout with the runner and CLI:

```bash
bun run --filter @yoqa/cli build
bun run --filter @yoqa/runner build
export YOQA_REPO_ROOT="$(git rev-parse --show-toplevel)"
yoqa health
yoqa runtime ensure
yoqa devices android --booted-only   # or: yoqa devices ios --booted-only
yoqa devices connect <device-id> --platform android --app-package ai.yoqa.demo
# yoqa devices connect <udid> --platform ios --bundle-id ai.yoqa.demo
./yoqa/seed-catalog.sh
yoqa runs create DEMO --cases 1 --mode script --wait
# or connector-only: ./yoqa/ci-smoke.sh
```

CI runs the catalog CaseScript ([`yoqa/smoke.yoqa.json`](./yoqa/smoke.yoqa.json)): `assert` + `tap --label` (no vision / agent). Download `yoqa-expo-demo-*-report` from the GitHub Actions **run** Artifacts section for the HTML report. `ci-smoke.sh` is the same steps via `yoqa assert` / `yoqa action` for local debugging without a catalog.

## CI

See [`.github/workflows/demo-expo-e2e.yml`](../../.github/workflows/demo-expo-e2e.yml) and [`docs/cli/github-actions-expo.md`](../../docs/cli/github-actions-expo.md).

That workflow is **not** a required status check. Trigger it with `workflow_dispatch` or by changing the demo, CLI, runner, or the workflow file.
