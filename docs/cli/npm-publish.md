# Publish `@yoqa/cli` to npm

## Goal

Ship a Node-compatible Yoqa CLI on npm so terminals and CI/CD can run `npx @yoqa/cli` / `npm i -g @yoqa/cli` without installing from the desktop app.

## Plan summary

- Extract the thin HTTP CLI from `@yoqa/runner` into public package `@yoqa/cli` (`packages/cli`).
- Use a **scoped** name: unscoped `yoqa` is blocked by npm typosquat rules (too similar to `yo`, `yosay`, `ora`, `koa`).
- Build with `bun build --target node` and bundle `@yoqa/runner-client` so consumers need no unpublished workspace deps.
- Keep the local runner as a pipeline prerequisite; do not publish the Appium runner yet.
- Automate publish on `v*` tags via `.github/workflows/release-npm-cli.yml` + `release` Environment secret `NPM_TOKEN`.

## What shipped

- [`packages/cli`](../../packages/cli) — `name: @yoqa/cli`, `bin.yoqa` → `dist/main.js`, Node ≥20
- Desktop sidecar + Settings CLI path retargeted to `packages/cli/src/main.ts`
- Docs: Mintlify CLI page (npm + CI example), this note, release secret docs
- Workflow: `release-npm-cli.yml` (owner authorize → build → `npm publish`)

## How to verify

1. `bun run --filter @yoqa/cli build`
2. `node packages/cli/dist/main.js --help` / `--version`
3. With runner up: `node packages/cli/dist/main.js health`
4. `cd packages/cli && npm pack --dry-run` (expect `dist/` + metadata; `bin.yoqa` present)
5. Owner one-time:
   - Create npm org **`yoqa`** (or ensure you can publish under `@yoqa`)
   - Add `NPM_TOKEN` (granular, read/write, **Bypass 2FA**, scoped to `@yoqa` or all packages) to GitHub Environment **release**
   - Push a `v*` tag, approve the deployment
   - Confirm `npx @yoqa/cli@<version> --version` / `health`

## Follow-ups

- Publish a runnable runner package (or binary) for headless CI without a repo checkout
- Optional public `@yoqa/runner-client`
- Open-source license if the CLI should not stay `UNLICENSED`
- Optional: Trusted Publishing (OIDC) once `@yoqa/cli` exists on npm
