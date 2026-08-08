# Contribution & security gates

## Goal

Harden how YoQA accepts contributions and ships releases: branch/PR lifecycle, CI gates, owner-only releases, and public security reporting.

## Plan summary

- Start plan-and-build work on a dedicated branch; finish with docs, commit, push, and PR using the repo template.
- Protect `main` with rebase-only merge, required reviews/CODEOWNERS, conversation resolution, and required Lint / Test / Typecheck.
- Restrict `v*` tags and the macOS release job to the repository owner, with a `release` Environment approval gate.
- Defer required signed commits and a full classic→rulesets migration.

## What shipped

- Cursor rules: plan-and-build lifecycle; merge/CI/release agent policy
- `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `dependabot.yml`, `typecheck.yml`
- Least-privilege + SHA-pinned Actions; release job uses `environment: release`
- `CONTRIBUTING.md`, `SECURITY.md`, `docs/desktop/release-signing-secrets.md`
- GitHub settings (already live): branch protection, tag ruleset, fork workflow approval, Dependabot security updates, `release` Environment

## How to verify

1. Open a PR from this branch — template and required checks should appear.
2. Confirm Settings → Branches / Rules / Environments / Actions match the docs in `CONTRIBUTING.md`.
3. As a non-owner, pushing a `v*` tag or running release should fail; owner still needs Environment approval.

## Follow-ups

- Done: owner PR-only ruleset bypass for **own** PRs; policy forbids bypass on others’ work (see `merge-and-ci.mdc` / `CONTRIBUTING.md`)
- Optional: invite a second maintainer so owner self-PRs can use normal approvals instead of bypass
- Optional: require signed commits; finish classic → rulesets migration (status checks still on classic)
- Add codesign/notarize Environment secrets when ready
