#!/usr/bin/env bash
# Open `ready-for-agent` tickets for the planner, as a JSON array.
#
# Parent issues (specs with sub-issues) are left out: they are not tickets.
# `openBlockers` lists each ticket's open "blocked by" issues from GitHub's
# native issue dependencies; a ticket with any open blocker cannot start yet.
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

gh api --paginate "repos/$repo/issues?state=open&labels=ready-for-agent&per_page=100" \
	--jq '.[] | select(.pull_request == null) | select((.sub_issues_summary.total // 0) == 0) | .number' |
	while read -r number; do
		blockers=$(gh api "repos/$repo/issues/$number/dependencies/blocked_by" \
			--jq '[.[] | select(.state == "open") | .number]')
		gh issue view "$number" --repo "$repo" --json number,title,body,labels,comments |
			jq --argjson blockers "$blockers" \
				'{number, title, body, labels: [.labels[].name], comments: [.comments[].body], openBlockers: $blockers}'
	done |
	jq -s 'sort_by(.number)'
