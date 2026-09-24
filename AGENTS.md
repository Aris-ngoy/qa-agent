## Agent skills

### Issue tracker

Issues live in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label string equals role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Contribution gates

`main` is protected. These rules apply to every change, whoever or whatever tool authors it (human-facing version: `CONTRIBUTING.md`).

- **PRs only.** Never push commits directly to `main`; work on a `<area>/<slug>` branch and open a PR. Merge method is **rebase only** (no merge commits, no squash on GitHub). Rebase the branch onto `main` before merge; keep history linear. Resolve all review conversations first.
- **Required checks** — a PR is not mergeable unless all three are green: **Lint & format** (`bun run lint:ci`), **Unit tests** (`bun run test`), **Typecheck** (`bun run check`). Treat red or incomplete as a reject: fix and push; never ask to skip CI or disable protection.
- **Reviews.** One approving review is required, and CODEOWNERS must approve owned paths (`.github/CODEOWNERS`). Authors cannot approve their own PRs.
- **Owner bypass — own work only.** The `PR reviews on main` ruleset gives the repository owner a `pull_request`-mode bypass so solo owner PRs land without a second reviewer. Use it **only** on owner-authored PRs, and only when checks are green, threads resolved, and the branch up to date. **Never** bypass (e.g. `gh pr merge --admin`) anyone else's PR — contributor and Dependabot PRs still need a real approval. The bypass does not allow direct pushes, deletions, or force-pushes to `main`.
- **Fork PRs.** External workflows need maintainer approval before Actions runs; review the diff (especially `.github/workflows/**`) before approving.
- **Releases.** Only the repository owner may push `v*` tags; release secrets live only in the `release` Environment. Never commit them, use `--no-verify`, or force-push to `main`.

## Plan-and-build lifecycle

When work is **planned first** (design discussion, agreed plan) and then **implemented**, do this without waiting for a separate request. Skip for tiny one-off fixes, pure Q&A, or doc/rule-only changes.

**Before implementing:** confirm the base is up to date (`git fetch`; start from `main` or the branch the user named), then create one dedicated branch for the plan.

**After implementing** (or at a meaningful milestone), in this order, in the same turn:

1. **Document** — update the docs entry below.
2. **Commit** — stage feature changes *and* docs together; HEREDOC message focused on why.
3. **Push** — `git push -u origin HEAD` if needed.
4. **PR** — `gh pr create` against the base branch, following `.github/PULL_REQUEST_TEMPLATE.md`. If a PR for the branch already exists, update it and share its URL instead of opening a duplicate.
5. **CI gates** — rebase onto `main` if behind; if a required check fails, fix and push until green (never merge red or ask to bypass).

### Docs to write

| Kind of work | Path |
|--------------|------|
| Feature / domain change | `docs/<area>/<short-slug>.md` (e.g. `docs/providers/provider-settings.md`) |
| Cross-cutting / architecture | `docs/architecture/<short-slug>.md` |
| One-off session notes | `docs/sessions/YYYY-MM-DD-<short-slug>.md` |

Prefer a durable area doc when the topic will keep evolving; use a session note for ephemeral build logs. Every new or updated doc covers: **Goal** (what we set out to do), **Plan summary** (key decisions and rejected alternatives, brief), **What shipped** (concrete changes, not a file dump), **How to verify**, **Follow-ups** (or "none"). Link existing specs (`ARCHITECTURE.md`, `CONTEXT.md`) instead of duplicating them. See `docs/README.md` for the map.
