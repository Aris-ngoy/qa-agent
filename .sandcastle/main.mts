// Parallel planner with review, adapted to this repo's contribution gates.
//
//   Plan:    an agent reads the open `ready-for-agent` tickets (with GitHub's
//            "blocked by" edges) and picks the unblocked ones.
//   Execute: each ticket gets its own worktree and branch, cut from the
//            integration branch; an implementer works it, then a reviewer.
//   Land:    one agent cherry-picks the finished branches onto the integration
//            branch (linear history: main merges by rebase only), runs the three
//            required checks, and closes the tickets that landed.
//   Push:    this script pushes the integration branch from the host.
//
// Nothing here writes to your checkout or to `main`. The integration branch
// lives in its own worktree under .sandcastle/worktrees/, so it must not be
// checked out in your working tree. Open the PR to `main` from it yourself.
//
// Usage: bun run sandcastle   (SANDCASTLE_BRANCH overrides the integration branch)

import { execFileSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";

const INTEGRATION_BRANCH = process.env.SANDCASTLE_BRANCH ?? "feat/web-support";

// Plan→execute→land cycles before stopping; each cycle unblocks the next tickets.
const MAX_ITERATIONS = 10;

const MODEL = "claude-opus-5-5";

const planSchema = z.object({
	issues: z.array(z.object({ id: z.string(), title: z.string(), branch: z.string() })),
});

// Each worktree gets a Linux install of its own. Host node_modules are not
// copied in: they hold macOS-only binaries (Biome, Bun).
const installHooks = {
	sandbox: { onSandboxReady: [{ command: "bun install --frozen-lockfile", timeoutMs: 300_000 }] },
};

function git(...args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function branchExists(branch: string): boolean {
	try {
		git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
		return true;
	} catch {
		return false;
	}
}

if (/^(main|master|release\/)/.test(INTEGRATION_BRANCH)) {
	throw new Error(`Refusing to use ${INTEGRATION_BRANCH} as the integration branch.`);
}
if (git("branch", "--show-current") === INTEGRATION_BRANCH) {
	throw new Error(
		`${INTEGRATION_BRANCH} is checked out here. Switch to another branch (e.g. main): Sandcastle works on it in its own worktree.`,
	);
}
if (!branchExists(INTEGRATION_BRANCH)) {
	// Cut from HEAD so the integration branch carries this .sandcastle/ setup.
	git("branch", INTEGRATION_BRANCH, "HEAD");
	console.log(`Created ${INTEGRATION_BRANCH} from HEAD.`);
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
	console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} on ${INTEGRATION_BRANCH} ===\n`);

	// Plan: read-only, so it runs against the host checkout with no install.
	const plan = await sandcastle.run({
		sandbox: docker(),
		name: "planner",
		maxIterations: 1,
		agent: sandcastle.claudeCode(MODEL),
		promptFile: "./.sandcastle/plan-prompt.md",
		output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
	});

	const issues = plan.output.issues;
	if (issues.length === 0) {
		console.log("No unblocked tickets. Exiting.");
		break;
	}

	console.log(`Planning complete. ${issues.length} ticket(s) to work in parallel:`);
	for (const issue of issues) {
		console.log(`  #${issue.id}: ${issue.title} → ${issue.branch}`);
	}

	// Execute + review: one worktree per ticket; a failing pipeline does not
	// cancel the others.
	const settled = await Promise.allSettled(
		issues.map(async (issue) => {
			const sandbox = await sandcastle.createSandbox({
				branch: issue.branch,
				baseBranch: INTEGRATION_BRANCH,
				sandbox: docker(),
				hooks: installHooks,
			});

			try {
				const implement = await sandbox.run({
					name: `implementer #${issue.id}`,
					maxIterations: 100,
					agent: sandcastle.claudeCode(MODEL),
					promptFile: "./.sandcastle/implement-prompt.md",
					promptArgs: {
						TASK_ID: issue.id,
						ISSUE_TITLE: issue.title,
						BRANCH: issue.branch,
						BASE_BRANCH: INTEGRATION_BRANCH,
					},
				});

				if (implement.commits.length === 0) return implement;

				const review = await sandbox.run({
					name: `reviewer #${issue.id}`,
					maxIterations: 1,
					agent: sandcastle.claudeCode(MODEL),
					promptFile: "./.sandcastle/review-prompt.md",
					promptArgs: { BRANCH: issue.branch, BASE_BRANCH: INTEGRATION_BRANCH },
				});

				// Each run returns only its own commits; the land step needs both.
				return { ...review, commits: [...implement.commits, ...review.commits] };
			} finally {
				await sandbox.close();
			}
		}),
	);

	for (const [i, outcome] of settled.entries()) {
		if (outcome.status === "rejected") {
			console.error(`  ✗ #${issues[i]?.id} (${issues[i]?.branch}) failed: ${outcome.reason}`);
		}
	}

	const completedIssues = issues.filter((_, i) => {
		const outcome = settled[i];
		return outcome?.status === "fulfilled" && outcome.value.commits.length > 0;
	});

	console.log(`\nExecution complete. ${completedIssues.length} branch(es) with commits.`);
	if (completedIssues.length === 0) {
		console.log("No commits produced. Nothing to land.");
		continue;
	}

	// Land: in a worktree on the integration branch, never the host checkout.
	await sandcastle.run({
		sandbox: docker(),
		branchStrategy: { type: "branch", branch: INTEGRATION_BRANCH },
		hooks: installHooks,
		name: "lander",
		maxIterations: 1,
		agent: sandcastle.claudeCode(MODEL),
		promptFile: "./.sandcastle/merge-prompt.md",
		promptArgs: {
			BASE_BRANCH: INTEGRATION_BRANCH,
			BRANCHES: completedIssues.map((issue) => `- ${issue.branch}`).join("\n"),
			ISSUES: completedIssues.map((issue) => `- #${issue.id}: ${issue.title}`).join("\n"),
		},
	});

	git("push", "--set-upstream", "origin", `refs/heads/${INTEGRATION_BRANCH}`);
	console.log(`\nLanded and pushed ${INTEGRATION_BRANCH}.`);
}

console.log(`\nAll done. Open a PR from ${INTEGRATION_BRANCH} to main when you're ready.`);
