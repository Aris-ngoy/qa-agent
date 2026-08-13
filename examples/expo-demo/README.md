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
npx expo prebuild --platform android
npx expo run:android --variant release --no-bundler
```

`expo prebuild` generates `android/` (gitignored). `expo run:android` then builds, installs, and launches. CI uses the same Expo CLI commands.

Then, from a repo checkout with the runner and CLI:

```bash
bun run --filter @yoqa/cli build
bun run --filter @yoqa/runner build
export YOQA_REPO_ROOT="$(git rev-parse --show-toplevel)"
yoqa health
yoqa runtime ensure
yoqa devices android --booted-only
yoqa devices connect <device-id> --platform android --app-package ai.yoqa.demo
./yoqa/ci-smoke.sh
```

`ci-smoke.sh` is the same script GitHub Actions runs: `yoqa assert` + `yoqa action --label` (no vision / agent).

## CI

See [`.github/workflows/demo-expo-e2e.yml`](../../.github/workflows/demo-expo-e2e.yml) and [`docs/cli/github-actions-expo.md`](../../docs/cli/github-actions-expo.md).

That workflow is **not** a required status check. Trigger it with `workflow_dispatch` or by changing the demo, CLI, runner, or the workflow file.
