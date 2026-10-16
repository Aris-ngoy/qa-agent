# TASK

Implement issue #{{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue with `gh issue view {{TASK_ID}} --comments`. Its **Parent** section names the spec issue; pull that in too with `gh issue view <parent>`.

Only work on this issue. You are on branch `{{BRANCH}}`, cut from the integration branch `{{BASE_BRANCH}}`.

# CONTEXT

Read `AGENTS.md`, `CONTEXT.md` (the domain glossary: use its terms), and the ADRs under `docs/adr/` that touch your area before writing code. `ARCHITECTURE.md` is partly historical: ADR-0005 wins over anything there that mentions Appium.

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with what you need to complete the task. Pay extra attention to tests that touch the relevant code, especially the Lane contract suite and its harnesses for anything about a Lane.

# EXECUTION

Work test-first where it applies:

1. RED: write one test at the highest existing seam
2. GREEN: write the implementation that passes it
3. REPEAT until the issue's acceptance criteria are met
4. REFACTOR

Write code that reads like the surrounding code: match its comment density, naming, and idioms. When the issue asks for a feature doc, write it under `docs/<area>/` as `AGENTS.md` describes (Goal, Plan summary, What shipped, How to verify, Follow-ups). Update `CONTEXT.md` only when the issue says to, and keep it a glossary.

This sandbox is Linux. macOS-only tools (xcrun, simctl, Xcode) are not available; use the fakes and seams the tests already use.

# FEEDBACK LOOPS

Before every commit, run all three required checks and make them pass:

- `bun run lint:ci`
- `bun run test`
- `bun run check`

Use `bun run lint:fix` to fix formatting.

# COMMIT

Commit in the repo's style: a short imperative subject line (no prefix), then a body that says why, the key decisions, and anything left for the next iteration. End the body with `Refs #{{TASK_ID}}`. Never use `--no-verify`.

# THE ISSUE

If the task is not complete, leave a comment on the issue saying what was done and what is left.

Do not close the issue; that happens when it lands on the integration branch.

Once every acceptance criterion is met and the checks pass, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK. Never push, and never touch `main`.
