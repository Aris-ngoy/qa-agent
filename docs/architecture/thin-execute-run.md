# Thin `executeRun`

## Goal

ADR-0003 (`docs/adr/0003-case-executor-test-seam.md`) says the **Case executor** is the Run test seam and `executeRun` stays thin orchestration + persistence. `runs/application.ts` (1068 lines) had drifted: case dispatch, the agent's learned-script rule, Run setup (App, start target, Provider, build install) and the row ↔ DTO mapping (written twice) all lived next to the loop, and a case's Case Script JSON was parsed up to three times per case (`resolveRunProfile`, `executeScriptCase`, the error message, the learned script's profile). Terms: `CONTEXT.md` (Run, Case executor, Case Script, Active Session, Run recording, Kept profile).

## Plan summary

- **Case dispatch moves into the Case executor.** `executeCase` (`runs/case-executor.ts`) takes a `CatalogCase` and its `mode`, replays `catalogCase.script` or runs the agent loop, and returns `{ status, error, learnedScript }`. The errors a Run reports for a case ("Saved script is missing or invalid", "Saved script replay failed", "No vision-capable provider…") and the rule "a passed agent case leaves a Case Script on the profile its old one asked for" now live there. `caseModeFor` (was `resolveCaseExecutionMode`) moves with it. The existing seam's deps (session, abort, step sink, clock, decide) are reused; no new seam.
- **Parse once.** The catalog's `getCase` already parses a case's Case Script into `catalogCase.script`. A Run now loads each case once at start (`prepareRun`) and passes that parsed form down: to the profile rule, the replay, and the learned script. `getCaseScriptJson` is no longer on the Run path.
- **Run setup is its own module.** `runs/run-setup.ts`: `prepareRun` (App + start target, cases + modes, Provider when any case needs the agent, build install), `runProfileOf` (pure profile rule over parsed scripts) and `openStartTarget`.
- **Persistence stays in `application.ts`**, as named steps: `runTest` (case row, last run, learned script, recording state), `persistFinished`, `persistErrored`, `persistCancelled`, and one `runFromRow` shared by `loadRun` and `listRuns`.
- **Session acquire stays inline in `executeRun`.** #424 (`requestedLane`) and #425 (`webDeviceOf`) edit those exact lines; they stay byte-for-byte so both PRs rebase cleanly. Same for `assertEverydayRunAllowed`.

Rejected:
- **Moving session acquire into `run-setup.ts` now.** It would conflict with #424 and #425; once they land, the block is a few lines and can move then if it still reads as policy.
- **Replacing `mock.module` in `web-run.test.ts` with injection.** The mocked `findEverydayBrowsers` is reached only through the Active Session registry → open-session → web Direct lane (`webDirectDeps().everydayBrowsers`). Passing it in means adding a session-opener dependency to `devices/active-session.ts`, which is candidate 3 of the architecture review (in flight elsewhere, `devices/` off-limits here). An injected `acquireSession` on `executeRun` would have only a fake adapter that cannot exercise the Everyday adopt/Allow behaviour those tests cover, so it is not a real seam.
- **A `run-store.ts` for all SQL.** Persistence is `executeRun`'s job by ADR-0003; moving it would be churn without new leverage.

## What shipped

- `executeRun` reads: load → mark running → `prepareRun` → acquire the Active Session (unchanged block) → `openStartTarget` → for each planned case `runTest` (Case executor inside Run recording) → `persistFinished` / `persistErrored` / `persistCancelled` → release.
- `runs/case-executor.ts`: `executeCase`, `caseModeFor`, `CaseMode`, `CaseDeps`, `CaseOutcome`.
- `runs/run-setup.ts`: `prepareRun`, `runProfileOf`, `openStartTarget`, `PlannedCase`, `RunPlan`.
- `runs/errors.ts`: `RunValidationError`, `RunNotFoundError` (re-exported from `application.ts`, so callers are unchanged).
- `application.ts`: 1068 → 859 lines; the three case wrappers, the duplicate DTO mapping and the local `sleep` are gone.
- Tests: `case-executor.test.ts` gains `caseModeFor` and `executeCase` cases (replay of the case's own script with no Provider, failed replay, missing script, agent without a Provider, learned script with and without the old profile). Run behaviour stays covered by `web-run.test.ts` and `interfaces/http/runs.test.ts`.

One intentional consequence: a Run reads each case once when it starts, not again just before running it. Editing a case's instructions or Case Script while its Run is in progress now takes effect on the next Run (a deleted case's run test row is removed by the cascade, as before).

## How to verify

- `bun run lint:ci`, `bun run check`, `bun run test` (on macOS the 5 known local failures: 3 web Direct lane screencast/scroll timing tests, `startYoqaAx` stop, `listOpenCodeModelsFromCli`).
- `bun test services/runner/src/domains/runs services/runner/src/interfaces/http/runs.test.ts`.
- Read `executeRun` in `services/runner/src/domains/runs/application.ts` top to bottom.

## Follow-ups

- After #424 and #425 land: consider moving the profile/session-acquire block into `run-setup.ts`.
- After candidate 3 (Active Session registry takes its session opener) lands: drop the `mock.module` in `web-run.test.ts` and inject the Everyday browser discovery there.
