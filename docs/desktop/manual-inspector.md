# Manual UI Inspector (script-first)

## Goal

Give desktop users a **Maestro-like** inspector for manual end-to-end testing: connect a device, select an element on the live screenshot, choose an action from a floating menu (Insert / Insert & Run / Copy), build a runnable `yoqa` shell script, and **save it as a catalog test case** with a replayable CaseScript.

## Plan summary

- **Script format:** Bash-style lines (`yoqa action …`, `yoqa assert …`, `sleep N`) — not Maestro YAML.
- **Interaction model:** Cached Select Mode (warm accessibility tree when Live control is off) → hover preview + instant click hit-test → **hold Control** to pick a raw screenshot `x,y` when hit-test cannot select a control → floating action menu → Insert / Insert & Run / Copy. Double-click still inserts a tap shortcut (not while Control is held). Live control keeps continuous MJPEG without source.
- **Screenshot coords:** Inspector Control-pick, `tap (x,y)`, and agent in-app taps use the 0–1000 grid of the **screenshot image** on both iOS and Android. Locator taps (`--id` / `--label`) still resolve against the accessibility tree. System permission sheets still use label/alert, not guessed coords.
- **Input text:** Menu action focuses the selected field (`--id` / `--label` / coords) then types; runner taps whenever coordinates are resolved.
- **Save as test case:** Convert convertible shell steps → CaseScript (`tap` / `type` / `wait`), `createCase` + `updateCase({ script })`, open the new case.
- Rejected for this slice: All Commands catalog, View Docs, `scrollUntilVisible` / `copyTextFrom`, full assert/swipe in CaseScript, Maestro relational selectors (`above` / `childOf`).

## What shipped

**Runner**
- `input` taps to focus whenever `x,y` are present (id/label/description/coords), then types
- `tap` supports `--double` and `--duration` (long-press hold)
- Page-source cleaning skips URL-like iOS `name` values as ids/labels, drops unlabeled ScrollView/CollectionView/Table/WebView containers, and never falls back to the XML type as a label
- Coordinate-only taps (`--x/--y`, no `--id`/`--label`) inject in **screenshot space**: Android uses screenshot pixels even when they differ from `getWindowSize()`; iOS keeps window points (W3C). Locator taps stay window/tree-aligned.
- Agent in-app taps persist and replay screenshot `x,y`. Permission labels (`Allow`, `Don't allow`, …) still prefer `--label` / `alert`.
- Agent and CaseScript **swipe** use the same 0–1000 screenshot grid. Inspector command-bar swipes convert to CaseScript instead of being skipped.

**Client (`@yoqa/runner-client`)**
- `ActionRequest.double`; shell format/parse for `--double`
- `shellToCaseScript` — maps inspector shell → CaseScript (resolves `--id`/`--label` via optional element tree; warns on skipped steps)

**Desktop — Maestro-like picker**
- **Cached Select Mode:** clicks hit-test the cached cleaned tree locally (no “Reading screen…” per click). Tree warms when Live control turns off, after connect (deferred under Stream), after Insert & Run / scripts, and via **Refresh tree**. Stale cache (&gt;3s) triggers a background refresh without blocking the first highlight.
- **Hover preview:** dashed outline from the cached tree while Live control is off (no network).
- **Change Selector:** cycles preferred locator (`id` → `label` when both exist), then overlapping candidates smallest → largest (leaf → parent). Default preference is **`id`** when present.
- Active selector caption under the highlight (`id: …` / `label: …`).
- Suggested chips ordered by preference: `tap (id)` / `tap (label)` then always `tap (x,y)`. **Hold Control** over the screenshot to pick a point (crosshair + live `x,y`); click opens the action menu with coords-only `tap (x,y)` / `doubleTap` / `longPress` / `inputText` — no tree snap.
- Selection-anchored **ElementActionMenu** (suggested + Selector Commands; Insert / Insert & Run / Copy)
- **Hit-test** prefers elements with a usable `label`/`id`; when several share the same label (e.g. StaticText + Button “Continue”), selects the **largest** so the highlight covers the full word/control instead of a tiny nested leaf
- Under Stream, tree refresh still pauses MJPEG briefly (`GET /screen?pauseMjpeg=1`) then remounts the stream — never continuous pageSource + MJPEG
- Snippet generation only attaches `--id` / `--label` / assert `--text` when values look like real selectors (not deeplink URLs or `XCUIElementType…` type names); assert prompts for text when no usable label
- **Selector Commands** include app control: `activateApp` / `terminateApp` / `restartApp`, `openUrl`, `acceptAlert` / `dismissAlert` (App ID prefilled from selected app); and screenshots: `screenshot` / `screenshot (path)`
- Command bar: swipe + wait
- **Save as test case** on the run panel (requires selected app + convertible actions); recorded taps/inputs always include `--x/--y` so conversion does not depend on the live accessibility tree

## How to verify

1. Open desktop → **Inspector** → Connect a device (select an app first). Live control off → wait briefly for tree warm (or click **Refresh tree**).
2. Hover a labeled control: soft dashed outline tracks without pauses. Click: highlight + menu appear **without** “Reading screen…”. Stream stays up.
3. With both id and label present: chips show `tap (id)` first, then `tap (label)`, then `tap (x,y)`. Caption shows `id: …`.
4. **Change Selector:** first press flips caption/chips to `label`; next press expands to a parent/overlapping candidate when present.
5. Record taps / input / waits via the element menu (preferred locator + coordinates).
6. Selector quality: click a blank scroll area or a deeplink cell — tap should be coords-only (no `--id 'scheme://…'`, no `--label 'XCUIElementType…'`); assert should prompt for text instead of inserting the type name.
7. App control / deeplink: select any element → **Selector Commands** → `activateApp` → insert & run; or use `openUrl` / `acceptAlert` as needed.
8. Capture evidence: **Selector Commands** → `screenshot` → Insert & Run.
9. Insert & Run a navigation tap → tree refreshes once → next click stays fast on the new cache.
10. Click **Save as test case** → name the case → **Create test case**; confirm Script tab has actions.
11. Physical iOS: long Stream sessions survive (no continuous pageSource under MJPEG).
12. **Control-pick:** with Live control off, hold Control, move over a control the tree will not highlight, click — a point target and menu appear (`x,y` caption). Insert `tap (x,y)` (or double-tap / long-press / input). Save as test case → Script tab has `{ type: "tap", x, y }`. Replay on iOS and Android taps that screenshot point.

## Follow-ups

- All Commands catalog + View Docs links
- `scrollUntilVisible`, `copyTextFrom`, `extendedWaitUntil`
- CaseScript support for double / long-press / activate-app / open-url / screenshot
- Foreground-app awareness for `activateApp` prefill (catalog app vs visible process after deeplink)
- Maestro-style relational matching (`above` / `below` / `childOf`) and optional `--index` on `yoqa action`

See also: [MJPEG stream + live control](./manual-inspector-mjpeg-stream.md) (shipped).
