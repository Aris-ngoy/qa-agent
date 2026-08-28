# Android permission alerts

## Goal

Make agent and Inspector taps actually grant Android system permission dialogs (Allow / Don’t allow), after Playzone onboarding runs failed with four “successful” taps that never dismissed the notification sheet.

## Plan summary

Vision was guessing coordinates like `(269, 951)` on a 0–1000 grid. Those often miss Samsung system dialogs. `yoqa action tap --label 'Allow'` (or `--id`) already worked because it uses the accessibility tree center.

Decisions:

- Teach the agent to tap by **label / id**, or to send **`alert` accept**, instead of guessing coordinates for permission buttons.
- On Android, inject coordinate taps with UiAutomator `mobile: clickGesture` (and `dragGesture` for swipes) so system windows receive events. iOS keeps W3C `performActions`.
- Replace W3C-only `acceptAlert` with UiAutomator `mobile: acceptAlert`, then PermissionController resource-ids, then exact text `Allow`.
- Prefer `--label` / `--id` over `x,y` when both are present, so a model that emits both still hits Allow.
- Do **not** default `autoGrantPermissions` (would hide the dialog this case is meant to tap).

Rejected: scaling all taps to screenshot pixels when they differ from `getWindowSize()` — that would desync `--label` taps, which are cleaned against the window.

## What shipped

- [`android-gestures.ts`](../../services/runner/src/domains/devices/android-gestures.ts) — `injectTap` / `injectSwipe`; pointer size prefers the screenshot only when it matches the window.
- [`android-alerts.ts`](../../services/runner/src/domains/devices/android-alerts.ts) — accept/dismiss fallbacks for PermissionController and Samsung packageinstaller.
- [`session.ts`](../../services/runner/src/domains/devices/session.ts) — Inspector live taps and `session.tap` use the same injection path.
- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) — `tap` may include `label` / `id`; new `alert` action. Prompt: permission dialogs → label `Allow` or `alert` accept.
- Saved scripts, HTML reports, shell export, and `yoqa script run` persist and replay `alert`.

## How to verify

1. Re-run **#4 Onboarding** on SM-A356E (Playzone Sandbox). Expected: a **Tap: Allow** or **Accept alert** step that dismisses the notification dialog — not four no-op coordinate taps.
2. With the dialog on screen: `yoqa action tap --label 'Allow'` and `yoqa action alert` both grant it.
3. Inspector: live-tap Allow on a permission sheet (uses `clickGesture` on Android).

## Follow-ups

- Optional app/case capability `autoGrantPermissions` to skip dialogs entirely.
- If vision still guesses coordinates, consider snapping a nearby tree node before injecting.
- Screenshot vs window mismatch on some Samsung devices when the agent *must* tap by raw x,y — **addressed:** coordinate-only taps now scale with the screenshot on Android (`coordSpace: "screenshot"`). Locator taps still use the window.

## Related

- Failed run: `yoqa-run-run57fb5-errored.html` (#4 Onboarding, Sm A356e).
