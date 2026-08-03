# Manual UI Inspector (script-first)

## Goal

Give desktop users a **Maestro-like** inspector for manual end-to-end testing: connect a device, select an element on the live screenshot, choose an action from a floating menu (Insert / Insert & Run / Copy), build a runnable `yoqa` shell script, and **save it as a catalog test case** with a replayable CaseScript.

## Plan summary

- **Script format:** Bash-style lines (`yoqa action …`, `yoqa assert …`, `sleep N`) — not Maestro YAML.
- **Interaction model:** Click element → floating action menu (suggested commands + Selector Commands) → Insert / Insert & Run / Copy. Double-click still inserts a tap shortcut.
- **Input text:** Menu action focuses the selected field (`--id` / `--label` / coords) then types; runner taps whenever coordinates are resolved.
- **Save as test case:** Convert convertible shell steps → CaseScript (`tap` / `type` / `wait`), `createCase` + `updateCase({ script })`, open the new case.
- Rejected for this slice: hierarchical Change Selector tree, All Commands catalog, View Docs, `scrollUntilVisible` / `copyTextFrom`, full assert/swipe in CaseScript.

## What shipped

**Runner**
- `input` taps to focus whenever `x,y` are present (id/label/description/coords), then types
- `tap` supports `--double` and `--duration` (long-press hold)

**Client (`@yoqa/runner-client`)**
- `ActionRequest.double`; shell format/parse for `--double`
- `shellToCaseScript` — maps inspector shell → CaseScript (resolves `--id`/`--label` via optional element tree; warns on skipped steps)

**Desktop**
- Selection-anchored **ElementActionMenu** (suggested + Selector Commands; Insert / Insert & Run / Copy)
- Menu always opens to the right; `tap --x/--y` always offered alongside id/label taps
- Command bar: swipe + wait; **app control** (Activate / Terminate / Restart, Open Notes on iOS, Open URL, Accept/Dismiss alert)
- **Save as test case** on the run panel (requires selected app + convertible actions)

## How to verify

1. Open desktop → **Inspector** → Connect a device (select an app first).
2. Record taps / input / waits via the element menu.
3. App control / deeplink: **Open Notes** (iOS) → paste a deeplink in a note → tap the link → **Accept alert** if prompted → confirm the target app; or use **Open URL** with the deeplink directly. App ID pre-fills from the selected app for Activate / Terminate / Restart.
4. Click **Save as test case** → name the case → **Create test case**.
5. Confirm navigation to the new case Script tab with actions present.
6. Prefer **tap (x,y)** or ensure the live tree can resolve id/label; asserts/swipes/app lifecycle/open-url are skipped with warnings in the dialog when not convertible to CaseScript.

## Follow-ups

- Change Selector (cycle overlapping / parent-child hierarchy)
- All Commands catalog + View Docs links
- `scrollUntilVisible`, `copyTextFrom`, `extendedWaitUntil`
- CaseScript support for assert / swipe / double / long-press / activate-app / open-url
- Adaptive poll rate / MJPEG-style stream for lower latency
