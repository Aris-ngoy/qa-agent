# TASK

You are on the integration branch `{{BASE_BRANCH}}`. Land these finished issue branches on it, keeping history linear (the repo merges by rebase only, so no merge commits):

{{BRANCHES}}

For each branch, in the order listed:

1. Run `git cherry-pick HEAD..<branch>` to replay its commits on top of `{{BASE_BRANCH}}`.
2. If a commit conflicts, read both sides, resolve it correctly, `git add` the files and `git cherry-pick --continue`. If you cannot resolve it with confidence, run `git cherry-pick --abort`, skip this branch, and comment on its issue explaining the conflict.
3. Run `bun run lint:ci`, `bun run test` and `bun run check`. If one fails, fix it in a new commit before moving to the next branch. If you cannot get all three green, reset `{{BASE_BRANCH}}` back to where it was before this branch (`git reset --hard <sha>`), skip the branch, and comment on its issue with the failing output.

Never create a merge commit, never push, and never touch `main`.

# CLOSE ISSUES

For each branch that landed with all three checks green, close its issue:

`gh issue close <ID> --comment "Landed on {{BASE_BRANCH}} by Sandcastle as of <short sha of HEAD>."`

Do not close an issue whose branch was skipped. Here are all the issues:

{{ISSUES}}

Once you have landed everything you can, output <promise>COMPLETE</promise>.
