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
- Page-source cleaning skips URL-like iOS `name` values as ids/labels, drops unlabeled ScrollView/CollectionView/Table/WebView containers, and never falls back to the XML type as a label

**Client (`@yoqa/runner-client`)**
- `ActionRequest.double`; shell format/parse for `--double`
- `shellToCaseScript` — maps inspector shell → CaseScript (resolves `--id`/`--label` via optional element tree; warns on skipped steps)

**Desktop**
- Selection-anchored **ElementActionMenu** (suggested + Selector Commands; Insert / Insert & Run / Copy)
- Menu always opens to the right; `tap --x/--y` always offered alongside id/label taps
- Snippet generation only attaches `--id` / `--label` / assert `--text` when values look like real selectors (not deeplink URLs or `XCUIElementType…` type names); assert prompts for text when no usable label
- **Selector Commands** include app control: `activateApp` / `terminateApp` / `restartApp`, `openUrl`, `acceptAlert` / `dismissAlert` (App ID prefilled from selected app); and screenshots: `screenshot` / `screenshot (path)`
- Command bar: swipe + wait
- **Save as test case** on the run panel (requires selected app + convertible actions); recorded taps/inputs always include `--x/--y` so conversion does not depend on the live accessibility tree

## How to verify

1. Open desktop → **Inspector** → Connect a device (select an app first).
2. Record taps / input / waits via the element menu (id/label taps also get coordinates).
3. Selector quality: click a blank scroll area or a deeplink cell — tap should be coords-only (no `--id 'scheme://…'`, no `--label 'XCUIElementType…'`); assert should prompt for text instead of inserting the type name. A labeled button still emits `--id` / `--label` plus coords.
4. App control / deeplink: select any element → **Selector Commands** → `activateApp` (e.g. `com.apple.mobilenotes`) → insert & run; paste a deeplink in Notes → tap it → `acceptAlert` if prompted; or use `openUrl` with the deeplink directly.
5. Capture evidence: **Selector Commands** → `screenshot` or `screenshot (path)` → Insert & Run.
6. Click **Save as test case** → name the case → **Create test case**.
7. Confirm navigation to the new case Script tab with actions present.
8. Prefer **tap (x,y)** or id/label taps (Inspector now also records `--x/--y` with selectors so Save as test case works after the screen tree changes). Asserts/swipes/app lifecycle/open-url/screenshot are skipped with warnings when not convertible to CaseScript.

## Follow-ups

- Change Selector (cycle overlapping / parent-child hierarchy)
- All Commands catalog + View Docs links
- `scrollUntilVisible`, `copyTextFrom`, `extendedWaitUntil`
- CaseScript support for assert / swipe / double / long-press / activate-app / open-url / screenshot
- Adaptive poll rate / MJPEG-style stream for lower latency
- Foreground-app awareness for `activateApp` prefill (catalog app vs visible process after deeplink)
