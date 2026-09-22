# Agent instructions

These apply to **every coding harness** that works in this repo (Cursor, Claude Code, Codex, Copilot, OpenCode, and anything else that reads `AGENTS.md` or a thin adapter that imports it). This file is the source of truth. Do not treat `.cursor/rules` as Cursor-only policy.

---

# Plan-and-build: branch → ship → commit → PR

Whenever a feature or change is **planned first** (a written plan, design discussion, or an agreed build plan) and then **implemented**, follow this full lifecycle—do not wait for the user to ask for branch, commit, push, or PR.

## When this applies

- User asked to plan, then build / implement
- The session moved from planning into implementation and shipped the plan
- Multi-step builds that followed an explicit plan (even mid-conversation)

## When this does not apply

- Tiny one-off fixes with no plan step
- Pure Q&A or exploration with no implementation
- Documentation-only or rule-only changes (unless the plan itself was about docs)

## Start sequence (before writing code)

Do these **before** implementing the plan:

1. **Confirm base** — start from an up-to-date `main` (or the branch the user named as base): `git fetch` and checkout/pull as needed
2. **New branch** — create and switch to a dedicated branch for this plan, e.g. `git checkout -b <area>/<short-slug>`
   - One plan → one branch; do not implement on `main` or reuse an unrelated WIP branch
   - If already on a clean branch created for this plan, keep it; otherwise create a new one

## Completion sequence (after the plan is executed)

After implementation is complete (or after a meaningful partial milestone), do these **in order** in the same turn:

1. **Document** — write or update the docs entry (below)
2. **Commit** — stage the feature changes **and** the docs, then commit (follow the repo’s git commit protocol; HEREDOC message focused on why)
3. **Push** — push the branch to the remote (`git push -u origin HEAD` if needed)
4. **Merge request / PR** — open a pull request against the base branch with `gh pr create`, filling `.github/PULL_REQUEST_TEMPLATE.md` (Summary, Changes, Test plan, Merge readiness, Docs, Notes). Return the PR URL to the user. If a PR for this branch already exists, update it if needed and share the existing URL instead of opening a duplicate.
5. **CI gates** — follow [Merge & CI gates](#merge--ci-gates) below: rebase onto `main` if behind; if **Lint & format** or **Unit tests** fail, fix and push until green (do not merge or ask to bypass).

This rule **authorizes** branch creation, commit, push, and PR creation for plan-and-build work without an extra user request. Still never force-push to `main`, amend others’ commits, skip hooks, or update git config.

## What to write

Create or update a markdown file under `docs/`:

| Kind of work | Path |
|--------------|------|
| Feature / domain change | `docs/<area>/<short-slug>.md` (e.g. `docs/providers/provider-settings.md`) |
| Cross-cutting / architecture | `docs/architecture/<short-slug>.md` |
| One-off session notes | `docs/sessions/YYYY-MM-DD-<short-slug>.md` |

Prefer a durable area doc when the topic will keep evolving; use a session note for ephemeral build logs.

## Required sections

Every new or updated doc must cover:

1. **Goal** — what we set out to do (from the plan)
2. **Plan summary** — key decisions and rejected alternatives (brief)
3. **What shipped** — concrete changes (packages/files/APIs/UI), not a file dump
4. **How to verify** — how someone can check it works
5. **Follow-ups** — known gaps, TODOs, or next steps (or “none”)

Keep it concise. Link to existing specs (`ARCHITECTURE.md`, etc.) instead of duplicating them.

---

# Merge & CI gates

`main` is protected. Do not merge (or advise merging) a PR that violates these rules.

## Pull requests required

- Do **not** push commits directly to `main`. Always use a feature branch + PR.
- Merge method is **rebase only** (no merge commits, no squash on GitHub).
- Before merge, the branch must be **up to date with `main`**. Prefer `git fetch origin && git rebase origin/main` (resolve conflicts, then force-push with lease only on the feature branch).
- Keep history linear. Do not merge `main` into the feature branch with a merge commit when updating.
- **All review conversations must be resolved** before merge.

## Reviews required

- At least **one approving review** is required (stale reviews dismiss on new pushes).
- **CODEOWNERS** reviews are required for owned paths (see `.github/CODEOWNERS`).
- Authors cannot approve their own PRs.
- Required status checks stay enforced for everyone (`enforce_admins` on classic protection) — never skip CI.

### Owner bypass — own work only

GitHub grants the **repository owner** a ruleset bypass (`pull_request` mode) so solo owner PRs can merge without a second reviewer. That capability is **scoped by policy**, not by the API:

- **Allowed:** use the bypass **only** when the PR **author is the repository owner** (the owner’s own work), and all required checks are green, threads are resolved, and the branch is up to date.
- **Forbidden:** do **not** use bypass / `--admin` / admin merge on anyone else’s PR. Contributor and Dependabot PRs still need a real approving review (typically the owner as CODEOWNER) before merge.
- Prefer merging owner self-PRs via the REST merge endpoint (ruleset bypass) rather than disabling protection or asking to drop reviews globally.

## Required checks (must pass)

A PR **must not** be merged if any required check is failing, pending, or cancelled. Required checks:

| Check | Workflow | What it runs |
|-------|----------|--------------|
| Lint & format | `.github/workflows/lint.yml` | `bun run lint:ci` (Biome) |
| Unit tests | `.github/workflows/test.yml` | `bun run test` |
| Typecheck | `.github/workflows/typecheck.yml` | `bun run check` |

Treat a red or incomplete check as a **reject**: fix the code (or flake), push, and wait for green. Do not ask the user to bypass or disable protection.

## Fork workflow runs

External / fork PRs require maintainer approval before Actions run (`all_external_contributors`). Do not approve fork workflow runs until you have reviewed the diff (especially `.github/workflows/**`).

## Releases

- Only the **repository owner** may create/update/delete `v*` tags (tag ruleset) and pass the authorize step (`github.actor == github.repository_owner`).
- The publish job uses the GitHub Environment **`release`** (required reviewer). Approve the deployment in the Actions UI after the tag push.
- Future codesign/notarize secrets belong in **Environment secrets** on `release` only — see `docs/desktop/release-signing-secrets.md`. Never commit them.
- Do not push `v*` tags or trigger releases unless the user is the owner and explicitly asks.

## Agent behavior

- After opening or updating a plan-and-build PR, if checks fail, fix and push until green (or clearly report a blocker).
- Never use `--no-verify` or force-push to `main`.
- Never merge a PR that is behind `main`, has unresolved conversations, or has failing required checks.
- For **owner-authored** PRs only: after green checks, merging via ruleset bypass is OK. For **any other author**: require a real approval first; never admin-bypass their review gate.

## Local checks

```bash
bun install --frozen-lockfile
bun run lint:ci
bun run test
bun run check
```

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Aris-ngoy/qa-agent via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
