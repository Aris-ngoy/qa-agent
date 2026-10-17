# Sandcastle: AFK agents on `ready-for-agent` tickets

## Goal

Let coding agents work through a ticket breakdown (first: web support, #302–#312 under spec #301) unattended, in isolated containers, without breaking the contribution gates in [AGENTS.md](../../AGENTS.md): no pushes to `main`, linear history, and all three required checks green.

## Plan summary

- **[Sandcastle](https://github.com/mattpocock/sandcastle)** (`@ai-hero/sandcastle`) orchestrates the agents. Its sandbox provider is Docker, served locally by **OrbStack**.
- **Template:** `parallel-planner-with-review`. A planner picks the unblocked tickets, an implementer and then a reviewer work each one on its own branch, and a lander integrates the results.
- **Landing on an integration branch.** All finished work lands on one branch (default `feat/web-support`), and a human opens the PR to `main`. The stock template merged into whatever branch was checked out, with merge commits, so it was replaced. Rejected alternative: one PR per ticket. That is cleaner to review, but the loop stalls at every blocked ticket until a human merges.
- **Ticket graph:** read from GitHub's native "blocked by" dependencies, not inferred by the planner. Parent specs (issues with sub-issues) are never picked.

## What shipped

- **`.sandcastle/`**
  - `Dockerfile`: Node 22, git, `gh`, Claude Code, and Bun pinned to the repo's `packageManager` version.
  - `ready-issues.sh`: lists open `ready-for-agent` tickets with their open blockers.
  - Prompts: plan, implement, review, merge ("lander").
  - `CODING_STANDARDS.md`: the reviewer's checklist, drawn from AGENTS.md, CONTEXT.md and the ADRs.
  - `main.mts`: the orchestration loop.
- **Integration branch.** `main.mts` works on `feat/web-support`, or on `SANDCASTLE_BRANCH` if set:
  - Every ticket branch (`sandcastle/issue-<n>`) is cut from it.
  - The lander cherry-picks finished branches onto it in its own worktree, runs `lint:ci`, `test` and `check`, and closes the tickets that landed green. A branch that conflicts or fails is skipped, with a comment on its issue.
  - The host then pushes the integration branch.
  - The script refuses `main`, `master` and `release/*`, and never touches your checkout.
- **Turbo cache.** A worktree's `.git` points at the host's absolute repo path, so the image sets `TURBO_CACHE_DIR` to a container path. Without it, `bun run check` fails trying to create a macOS cache directory.
- **Staying awake.** `bun run sandcastle` runs under `caffeinate -is`, so the Mac doesn't idle-sleep mid-run (`-s` only applies on power). The first overnight run went to sleep at 01:50, and the dropped network then failed an install, idled an agent out, and timed out the issue script. Closing the lid still sleeps an Apple silicon Mac unless an external display is attached.
- **Landing is retried.** A ticket lands when its pipeline finished cleanly and its branch is ahead of the integration branch, not only when this round committed. A landing that throws is logged and retried next round, instead of ending the loop.
- **Linux installs only.** Each worktree runs its own `bun install` inside the container. Host `node_modules` (macOS binaries) are never copied in.
- **Repo wiring.** `bun run sandcastle` runs the loop. `@ai-hero/sandcastle` and `zod` (3.x, the version the workspaces use) are root dev dependencies. Biome ignores `.sandcastle/worktrees/` and `.sandcastle/logs/`.

## How to verify

One-time setup:

1. Install OrbStack (`brew install --cask orbstack`) and open it once.
2. Build the image with `bunx sandcastle docker build-image` (rebuild after editing the Dockerfile).
3. Copy `.sandcastle/.env.example` to `.sandcastle/.env` and fill it in yourself:
   - `CLAUDE_CODE_OAUTH_TOKEN`: from `claude setup-token`.
   - `GH_TOKEN`: a fine-grained token for this repo with Issues read/write and Metadata read.
   
   `.env` is git-ignored.

Checks:

- `bash .sandcastle/ready-issues.sh | jq -c '.[] | {number, openBlockers}'` lists the tickets, with #301 excluded and only #302 unblocked.
- The three required checks pass inside the image. Run them against a copy of the repo, not your checkout, so the Linux install doesn't overwrite your macOS `node_modules`. Inside the container (`--entrypoint bash`): `bun install --frozen-lockfile && bun run lint:ci && bun run test && bun run check`.
- Run the loop from any branch other than the integration branch (e.g. `main` once this has merged): `bun run sandcastle`. Watch `.sandcastle/logs/`. Then open a PR from `feat/web-support` to `main`.

## Follow-ups

- Not yet run end to end with real tokens. Watch the first iteration (#302) before leaving it alone.
- Merges to `main` stay human. The integration PR still needs green checks and a review, per AGENTS.md.
