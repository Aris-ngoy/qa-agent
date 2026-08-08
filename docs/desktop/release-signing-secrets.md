# Release environment secrets (codesign / notarize)

## Goal

When Apple codesign and notarization are added, signing material must live in the GitHub **`release`** Environment — never in the git repo, never in org/repo Actions secrets that every workflow can read.

## Plan summary

- Workflow job that publishes the DMG already uses `environment: release` with a required reviewer.
- Environment secrets are only exposed to jobs that target `release`, and only after the deployment is approved.
- Rejected: committing `.p12` / API keys; using repository-level secrets for signing (broader blast radius).

## What to store (later)

Add these as **Environment secrets** on [`release`](https://github.com/Aris-ngoy/qa-agent/settings/environments) (names illustrative):

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
