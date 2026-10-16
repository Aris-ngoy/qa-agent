# ISSUES

Here are the open `ready-for-agent` tickets in the repo. Parent specs are already left out.

<issues-json>

!`bash .sandcastle/ready-issues.sh`

</issues-json>

Each ticket's `openBlockers` lists the open issues GitHub records as blocking it ("blocked by"). That graph is authoritative.

# TASK

Pick the tickets that can be worked on in parallel right now.

A ticket is **unblocked** when its `openBlockers` is empty. Never pick a ticket with a non-empty `openBlockers`, even if the blocker looks finished.

Among the unblocked tickets, drop one from this round if it would clearly fight another picked ticket for the same files or module (likely merge conflicts). Keep the lower-numbered ticket in that case.

For each picked ticket, assign a branch name in the exact format `sandcastle/issue-{id}` (no slug or other suffix). It must be deterministic so re-planning the same ticket reuses its branch and keeps accumulated progress.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

If no ticket is unblocked, or there are no tickets, output `<plan>{"issues": []}</plan>` so the run can exit cleanly. Always emit the `<plan>` tags.
