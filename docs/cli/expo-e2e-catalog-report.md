# Expo Demo E2E: catalog HTML reports + iOS WDA

## Goal

Publish the same self-contained **HTML run report** from Demo Expo E2E that desktop **Export HTML** produces, and stop the iOS Simulator job failing on a 240s WebDriverAgent session timeout.

## Plan summary

- Seed a local catalog in CI (`yoqa apps create` + a checked-in CaseScript) and run `yoqa runs create DEMO --cases 1 --mode script --wait`.
- Extend CaseScript with **label/id taps** and **assert** so the smoke stays accessibility-based (no AI, no fragile coordinates).
- Upload HTML via [`.github/actions/yoqa-report`](../../.github/actions/yoqa-report/action.yml). Artifact is on the **run** summary (`yoqa-expo-demo-*-report`), not the job log.
- iOS: raise simulator session timeout to **10 minutes**, pin WDA `derivedDataPath` to `~/.yoqa/wda-sim` (cached), and precompile WDA in parallel with `expo run:ios`.

Rejected: generating a second HTML dialect from PNG folders; agent mode in CI; coordinate-only CaseScript.

## What shipped

- CaseScript: `tap` may use `label` / `id`; new `assert` action (`visible` / `not-visible`).
- CLI: `yoqa apps create`, `yoqa cases create|update --script-file`.
- Demo: [`examples/expo-demo/yoqa/smoke.yoqa.json`](../../examples/expo-demo/yoqa/smoke.yoqa.json), [`seed-catalog.sh`](../../examples/expo-demo/yoqa/seed-catalog.sh). `ci-ios.sh` / `ci-android.sh` create a catalog run. [`ci-smoke.sh`](../../examples/expo-demo/yoqa/ci-smoke.sh) remains for connector-only local debugging.
- Workflow: HTML artifact + Job Summary; iOS WDA prewarm + cache.

## How to verify

```bash
bun test packages/runner-client/src/case-script.test.ts packages/runner-client/src/shell-script.test.ts packages/runner-client/src/script-format.test.ts packages/runner-client/src/run-report.test.ts services/runner/src/domains/runs/case-executor.test.ts
```

GitHub: Actions → **Demo Expo E2E**. After a job finishes, open the **run** page → Artifacts → `yoqa-expo-demo-ios-report` or `yoqa-expo-demo-android-report` → `index.html`. Job Summary has the compact text report.

## Follow-ups

- Catalog import/export so CI does not hand-seed `~/.yoqa/yoqa.db`
- Make Demo Expo E2E a required check once iOS is stably green
- Optional ZIP of raw PNGs beside the HTML (see [report-export.md](../runs/report-export.md))
