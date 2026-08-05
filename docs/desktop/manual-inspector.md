# Manual UI Inspector (script-first)

## Goal

Give desktop users a **Maestro-like** inspector for manual end-to-end testing: connect a device, select an element on the live screenshot, choose an action from a floating menu (Insert / Insert & Run / Copy), build a runnable `yoqa` shell script, and **save it as a catalog test case** with a replayable CaseScript.

## Plan summary

- **Script format:** Bash-style lines (`yoqa action …`, `yoqa assert …`, `sleep N`) — not Maestro YAML.
- **Interaction model:** Click element (label-aware hit-test for full word/control bounds) → floating action menu to the right and downward (suggested commands + Selector Commands) → Insert / Insert & Run / Copy. Double-click still inserts a tap shortcut.
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
- **Hit-test** prefers elements with a usable `label`/`id`; when several share the same label (e.g. StaticText + Button “Continue”), selects the **largest** so the highlight covers the full word/control instead of a tiny nested leaf
- Under **MJPEG**, accessibility tree is fetched on click (and once shortly after connect) so suggested commands include `tap --id` / `tap --label` / text asserts — not only `tap (x,y)`
- Menu always opens to the **right** and **downward** (no upward flip near the bottom); `tap --x/--y` always offered alongside id/label taps
- Snippet generation only attaches `--id` / `--label` / assert `--text` when values look like real selectors (not deeplink URLs or `XCUIElementType…` type names); assert prompts for text when no usable label
- **Selector Commands** include app control: `activateApp` / `terminateApp` / `restartApp`, `openUrl`, `acceptAlert` / `dismissAlert` (App ID prefilled from selected app); and screenshots: `screenshot` / `screenshot (path)`
- Command bar: swipe + wait
- **Save as test case** on the run panel (requires selected app + convertible actions); recorded taps/inputs always include `--x/--y` so conversion does not depend on the live accessibility tree

## How to verify

1. Open desktop → **Inspector** → Connect a device (select an app first).
2. Click a labeled control (e.g. “Continue”): you may briefly see “Reading screen…” under Stream mode; highlight should cover the full button/word; the command menu opens to the right and downward; suggested actions include `tap` with `--id` and/or `--label`, not only `tap (x,y)`.
3. Record taps / input / waits via the element menu (id/label taps also get coordinates).
4. Selector quality: click a blank scroll area or a deeplink cell — tap should be coords-only (no `--id 'scheme://…'`, no `--label 'XCUIElementType…'`); assert should prompt for text instead of inserting the type name. A labeled button still emits `--id` / `--label` plus coords.
5. App control / deeplink: select any element → **Selector Commands** → `activateApp` (e.g. `com.apple.mobilenotes`) → insert & run; paste a deeplink in Notes → tap it → `acceptAlert` if prompted; or use `openUrl` with the deeplink directly.
6. Capture evidence: **Selector Commands** → `screenshot` or `screenshot (path)` → Insert & Run.
7. Click **Save as test case** → name the case → **Create test case**.
8. Confirm navigation to the new case Script tab with actions present.
9. Prefer **tap (x,y)** or id/label taps (Inspector now also records `--x/--y` with selectors so Save as test case works after the screen tree changes). Asserts/swipes/app lifecycle/open-url/screenshot are skipped with warnings when not convertible to CaseScript.

## Follow-ups

- Change Selector (cycle overlapping / parent-child hierarchy)
- All Commands catalog + View Docs links
- `scrollUntilVisible`, `copyTextFrom`, `extendedWaitUntil`
- CaseScript support for assert / swipe / double / long-press / activate-app / open-url / screenshot
- Foreground-app awareness for `activateApp` prefill (catalog app vs visible process after deeplink)

See also: [MJPEG stream + live control](./manual-inspector-mjpeg-stream.md) (shipped).
