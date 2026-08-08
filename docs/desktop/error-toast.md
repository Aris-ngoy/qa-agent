# HeroUI summarized error toast

## Goal

Show run start/cancel failures as short HeroUI danger toasts instead of dumping long runner messages inline (especially “No enabled AI provider configured…” with the full provider list).

## Plan summary

- Mount HeroUI v3 `Toast.Provider` at the app root (no other HeroUI provider needed).
- Centralize copy in `summarizeError` / `showErrorToast` so known provider failures get short titles + short descriptions.
- Wire runs-panel mutations only; leave other surfaces on inline errors for now.
- Rejected: duplicating toast + inline alert for the same failure.

## What shipped

- [`apps/desktop/src/mainview/main.tsx`](../../apps/desktop/src/mainview/main.tsx) — `<Toast.Provider />` inside `QueryClientProvider`.
- [`apps/desktop/src/mainview/app/show-error-toast.ts`](../../apps/desktop/src/mainview/app/show-error-toast.ts) — maps known vision/provider errors; truncates other messages to ~72 chars.
- [`apps/desktop/src/mainview/features/devices/runs-panel.tsx`](../../apps/desktop/src/mainview/features/devices/runs-panel.tsx) — create/cancel `onError` calls `showErrorToast`; removed `runError` inline alert.

## How to verify

1. With no AI provider enabled, start a run that needs agent/vision → danger toast titled **No AI provider configured** (not the full provider list).
2. Trigger a cancel-run failure → short danger toast.
3. Trigger twice quickly → toasts stack and auto-dismiss (~4s).

## Follow-ups

- Reuse `showErrorToast` on settings / providers / test-case mutation failures.
- Optional toast action to open Settings for provider-related errors.
