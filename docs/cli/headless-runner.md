# Headless CLI runner

## Goal

Let `yoqa` start the local runner without the desktop app, so GitHub Actions and other CI can run `yoqa health` / `yoqa doctor` / catalog commands after `npm i -g @yoqa/cli`.

## Plan summary

- Publish `@yoqa/runner` (Bun). The runner stays Bun-only (`Bun.serve`, `bun:sqlite`).
- CLI (`@yoqa/cli`, Node) spawns Bun on that package: `yoqa serve` in the foreground, auto-start on other commands when `:7420` is down.
- Rejected: porting the runner to Node; shipping per-platform compiled binaries in this pass (follow-up).

## What shipped

- `@yoqa/runner` npm package: `bun build --target bun` → `dist/index.js`, `yoqa-runner` bin stub that execs Bun. `webdriver` / `webdriverio` stay external.
- `yoqa serve` / `yoqa serve --stop`. Auto-start via Commander `preAction` unless `YOQA_NO_AUTOSTART=1`.
- Spawn order: `YOQA_RUNNER_BIN` → `yoqa-runner` on `PATH` → packaged desktop sidecar → monorepo `services/runner/src/index.ts` → `@yoqa/runner` dist.
- Release workflow publishes `@yoqa/runner` then `@yoqa/cli` on `v*` tags.
- `@yoqa/cli` depends on `@yoqa/runner` so one `npm i -g @yoqa/cli` is enough (Bun still required to execute the runner).

## How to verify

```bash
bun run --filter @yoqa/runner build
bun test packages/cli/src
node packages/cli/dist/main.js serve --help
```

Headless (no desktop):

```bash
# Terminal A
yoqa serve

# Terminal B
yoqa health
yoqa doctor
```

Or a single terminal: `yoqa health` auto-starts the runner if Bun and `@yoqa/runner` are installed.

GitHub Actions:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: "1.2.23"
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- run: npm i -g @yoqa/cli
- run: yoqa health
- run: yoqa doctor
```

Host Node/npm must be on `PATH` for managed Appium (`~/.yoqa/runtime`). Cache that directory between jobs. iOS still needs `macos-*` + Xcode; this is not a cloud device farm.

## Follow-ups

- Optional native `yoqa-runner` binaries on GitHub Releases so CI can skip Bun.
- Composite action `yoqa/setup`.
- Cloud farm / public run API (ARCHITECTURE §2.8).
- Device E2E in GitHub Actions against [`examples/expo-demo`](../../examples/expo-demo) — see [github-actions-expo.md](./github-actions-expo.md).
