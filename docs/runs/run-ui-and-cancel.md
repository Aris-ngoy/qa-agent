# Run UI + cancel

## Goal

After starting a test, navigate to a live run page, show in-progress details (status, steps, screenshot), turn the global play button into a red cancel control, and cancel the run on both UI and runner while keeping the run visible as `cancelled`. Finished runs open as a step review: click a step to see its screenshot and pass/fail. Sidebar **Runs** opens a history list for the selected app.

## Plan summary

- Red control = **cancel** (not pause/resume); visual uses pause bars.
- Persist cancelled runs and mark unfinished `run_tests` as `cancelled`.
- Poll `GET /runs/:id` (~1s) while `queued`/`running`; serve step screenshots over HTTP.
- Sidebar Runs → `/runs` list (badge `1` while a run is live).
- Live runs auto-follow the latest screenshot; finished runs (`passed` / `errored` / `cancelled`) use selectable steps with per-step pass/fail and a centered timeline rail.

## What shipped

**Runner**
- Cooperative cancel via in-memory abort flag in `executeRun` / `executeCase`
- `POST /runs/:runId/cancel` → `cancelRun()` (keeps row; status `cancelled`)
- `GET /runs?appId=` → `listRuns()` (tests without steps)
- `DELETE /runs/:runId` → `deleteRun()` (cancels if live, then deletes; FK cascade)
- `GET /runs/:runId/steps/:stepId/screenshot` streams PNG from step `screenshotUri`
- `runTestStatus` includes `cancelled`

**Client (`@yoqa/runner-client`)**
- `cancelRun(runId)` / `listRuns(appId)` / `deleteRun(runId)`
- `getRunStepScreenshotUrl(runId, stepId)`

**Desktop**
- `ActiveRunProvider` tracks `activeRunId` and live status (`setActiveRun(null)` supported)
- Runs panel: play → red pause while live; click cancels; start navigates to `/runs/$runId` and invalidates the list
- `RunsListPage` (`/runs`): Build / Device / Tests / Date table; row opens detail; trash deletes
- `RunDetailPage`: status, Stop, step timeline; breadcrumb **Runs** links back to list
  - **Live:** auto-follow latest step screenshot
  - **Finished:** clickable steps, Passed/Failed labels, check/X indicators, aside shows selected step’s screenshot
  - Timeline rail centered on step indicators
- Side menu Runs → `/runs` (badge `1` while live)

## How to verify

1. Select app + cases + device + build → Play → lands on `/runs/$id`; play becomes red pause.
2. Page polls: `queued` → `running`; steps appear; screenshot tracks the latest step.
3. Click red control (or Stop) → run and in-flight tests become `cancelled`; play returns.
4. Sidebar **Runs** → history list for the app; click a row → detail; trash removes the run.
5. Open a finished run → steps show Passed/Failed; click steps → aside updates; **Runs ›** returns to the list.

## Follow-ups

- Richer device labels (name/model) on the list and run header
- True pause/resume
- Case `last_run_status` for cancelled (currently skipped so list pills stay passed/errored only)
