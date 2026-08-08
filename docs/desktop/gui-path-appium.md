# GUI PATH + Appium install (v0.3.1)

## Goal

Make the packaged macOS `.app` able to ensure the managed Appium runtime when launched from Finder/Dock (not only from a developer terminal).

## Plan summary

- Finder/Dock give GUI apps a minimal `PATH` without Homebrew, so `which npm` failed.
- Prefer resolving `npm` next to an Appium-compatible Node binary; also prepend common host-tool dirs to `PATH` in the runner and desktop sidecar.
- Rejected for this cut: bundling Node/npm inside the DMG.

## What shipped

- `services/runner/src/domains/appium/host-path.ts` — PATH augmentation helper + tests
- `services/runner/src/domains/appium/application.ts` — host PATH, Homebrew Node candidates, sibling `npm`
- `apps/desktop/src/bun/features/runner-sidecar/index.ts` — pass augmented `PATH` + `YOQA_RUNNER_VERSION` into the sidecar
- Runner/CLI version read from `package.json` (no more hardcoded `0.1.0`)

## How to verify

1. Quit YoQA and anything on port `7420`
2. Open `/Applications/yoqa.app` from Finder (not Terminal)
3. Connect / ensure runtime — should find `/opt/homebrew/bin/npm` (or nvm sibling) without the previous PATH error
4. `curl -s http://127.0.0.1:7420/health` should report version `0.3.1`

## Follow-ups

- Optional Node/npm sidecar for machines with no host Node
- none otherwise for this bug
