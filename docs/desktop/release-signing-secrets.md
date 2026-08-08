# Release environment secrets

## Goal

Secrets for publishing releases (macOS codesign later, **npm CLI** now) live in the GitHub **`release`** Environment — never in the git repo, never in org/repo Actions secrets that every workflow can read.

## Plan summary

- Workflow jobs that publish (DMG, npm) already use `environment: release` with a required reviewer.
- Environment secrets are only exposed to jobs that target `release`, and only after the deployment is approved.
- Rejected: committing credentials; using repository-level secrets for release publish (broader blast radius).

## What to store

Add these as **Environment secrets** on [`release`](https://github.com/Aris-ngoy/qa-agent/settings/environments):

### npm (`@yoqa/cli`)

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npm granular access token with publish permission for `@yoqa/cli` (or the `@yoqa` scope). Enable **Bypass 2FA** for CI. |

Used by [`.github/workflows/release-npm-cli.yml`](../../.github/workflows/release-npm-cli.yml) as `NODE_AUTH_TOKEN`.

One-time setup:

1. Create the npm org **`yoqa`** (so you can publish `@yoqa/*`) and ensure 2FA is enabled on your account.
2. Create a granular token with read/write + **Bypass 2FA**, scoped to `@yoqa` (or all packages for the first publish).
3. Paste it into Environment **release** → `NPM_TOKEN`.
4. Bump [`packages/cli/package.json`](../../packages/cli/package.json) `version` to match the `v*` tag you will push (e.g. tag `v0.3.4` → version `0.3.4`).
5. Push the tag as the repository owner; approve the `release` deployment; confirm `npx @yoqa/cli@<version> --version`.

### Apple codesign / notarize (later)

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE_BASE64` | Developer ID Application certificate (`.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | Notarytool API key |
| `APPLE_TEAM_ID` | Team identifier |

Wire them only into the publish job that already has `environment: release` and `permissions.contents: write`.

## How to verify

1. Confirm secrets appear under Settings → Environments → **release** → Environment secrets (not Repository secrets).
2. Push a `v*` tag as the owner; approve the `release` deployment; confirm the job can read the secrets and a non-`release` workflow cannot.

## Follow-ups

- Implement notarize steps in `.github/workflows/release-macos.yml` once certs exist
- Consider `prevent_self_review: true` when a second maintainer can approve releases
