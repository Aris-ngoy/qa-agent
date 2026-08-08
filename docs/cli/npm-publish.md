# Publish `yoqa` CLI to npm

## Goal

Ship a Node-compatible `yoqa` CLI on npm so terminals and CI/CD can run `npx yoqa` / `npm i -g yoqa` without installing from the desktop app.

## Plan summary

- Extract the thin HTTP CLI from `@yoqa/runner` into public package `yoqa` (`packages/cli`).
- Build with `bun build --target node` and bundle `@yoqa/runner-client` so consumers need no unpublished workspace deps.
- Keep the local runner as a pipeline prerequisite (desktop or `bun run runner`); do not publish the Appium runner yet.
- Automate publish on `v*` tags via `.github/workflows/release-npm-cli.yml` + `release` Environment secret `NPM_TOKEN`.

## What shipped

- [`packages/cli`](../../packages/cli) — `name: yoqa`, `bin` → `dist/main.js`, Node ≥20
- Desktop sidecar + Settings CLI path retargeted to `packages/cli/src/main.ts`
- Docs: Mintlify CLI page (npm + CI example), this note, release secret docs
- Workflow: `release-npm-cli.yml` (owner authorize → build → `npm publish`)

## How to verify

1. `bun run --filter yoqa build`
2. `node packages/cli/dist/main.js --help` / `--version`
3. With runner up: `node packages/cli/dist/main.js health`
4. `cd packages/cli && npm pack --dry-run` (expect `dist/` + metadata only)
5. Owner one-time: claim `yoqa` on npm, add `NPM_TOKEN` to GitHub Environment **release**, push a `v*` tag, approve the deployment, confirm `npx yoqa@<version> health`

## Follow-ups

- Publish a runnable runner package (or binary) for headless CI without a repo checkout
- Optional public `@yoqa/runner-client`
- Open-source license if the CLI should not stay `UNLICENSED`
