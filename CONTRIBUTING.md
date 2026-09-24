# Contributing

Thanks for contributing to Yoqa (`qa-agent`).

## Pull requests

1. Branch from an up-to-date `main` (`<area>/<short-slug>`). **Direct pushes to `main` are blocked.**
2. Open a PR using the GitHub template (`.github/PULL_REQUEST_TEMPLATE.md`).
3. Keep the branch **rebased onto `main`** before merge (linear history). GitHub merge method is **rebase only**.
4. Get **at least one approving review** (CODEOWNERS must approve owned paths — see `.github/CODEOWNERS`). Authors cannot approve their own PRs.
5. **Resolve all review conversations** before merge.
6. Required checks must be green or the PR **cannot** merge:
   - **Lint & format** — `bun run lint:ci`
   - **Unit tests** — `bun run test`
   - **Typecheck** — `bun run check`

Do not merge with failing/pending checks, missing approval, or open review threads.

**Repository owner (solo):** may merge **their own** PRs via the ruleset PR-only bypass after CI is green (no second reviewer available). That bypass must **not** be used on other people’s PRs — contributors still need a real CODEOWNER / maintainer approval.

### Fork PRs

Workflows from external contributors require a maintainer to **approve the workflow run** before it executes. Maintainers should review the diff (especially workflow files) first.

## Releases

Only the **repository owner** can create `v*` tags. After the tag push, the owner must also **approve the `release` Environment** deployment in Actions (macOS DMG and **npm `@yoqa/cli`**). Contributors should not push release tags.

Signing / publish secrets live only in the `release` Environment — see [docs/desktop/release-signing-secrets.md](./docs/desktop/release-signing-secrets.md) (`NPM_TOKEN` for `@yoqa/cli`; Apple certs later).

## Security

Report vulnerabilities privately via [SECURITY.md](./SECURITY.md) — not public issues.

## Dependencies

Dependabot opens monthly PRs for Bun packages and GitHub Actions. Automated security-update PRs are off so patches land on that same monthly cadence; Dependabot alerts still notify on vulnerabilities. Review those PRs like any other.

## Local checks

```bash
bun install --frozen-lockfile
bun run lint:ci
bun run test
bun run check
```
