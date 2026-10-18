# GitHub Release notes

## Goal

Every macOS GitHub Release should ship **install/verify copy** plus a **changelog of what landed since the previous tag** — not install boilerplate alone.

## Plan summary

- Keep a short fixed `body` in [`.github/workflows/release-macos.yml`](../../.github/workflows/release-macos.yml) (Gatekeeper `xattr`, arm64, CLI install).
- Set `generate_release_notes: true` on `softprops/action-gh-release` so GitHub prepends that body to the auto-generated PR list for the tag range.
- Rejected: hand-writing a full “What's new” in the workflow (stale by the next tag); omitting install copy (users still need Gatekeeper steps).

## What shipped

- Workflow: `generate_release_notes: true` next to the install/verify body.
- Live fix: [v1.0.3](https://github.com/Aris-ngoy/qa-agent/releases/tag/v1.0.3) notes rewritten with a What's new summary + generated PR changelog (tag was already published before this workflow change).

## How to verify

1. After the next `v*` tag publish, open the Release page — body starts with Install/Notes/Verify, then `## What's Changed` with PRs since the previous tag.
2. To rewrite an already-published tag without re-running CI:

```bash
PREV=v1.0.2
TAG=v1.0.3
NOTES="$(gh api repos/Aris-ngoy/qa-agent/releases/generate-notes -f tag_name="$TAG" -f previous_tag_name="$PREV" --jq .body)"
# paste install boilerplate + optional What's new, then append "$NOTES"
gh release edit "$TAG" --notes-file -
```

## Follow-ups

none
