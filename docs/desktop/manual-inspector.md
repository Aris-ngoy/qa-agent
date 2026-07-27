# Manual UI Inspector (script-first)

## Goal

Give desktop users a **Maestro-like** inspector for manual end-to-end testing: connect a device, select an element on the live screenshot, choose an action from a floating menu (Insert / Insert & Run / Copy), and build a runnable `yoqa action` / `assert` / `sleep` shell script.

## Plan summary

- **Script format:** Bash-style lines (`yoqa action …`, `yoqa assert …`, `sleep N`) — not Maestro YAML.
- **Interaction model:** Click element → floating action menu (suggested commands + Selector Commands) → Insert / Insert & Run / Copy. Double-click still inserts a tap shortcut.
- **Input text:** Menu action focuses the selected field (`--id` / `--label` / coords) then types; runner taps whenever coordinates are resolved.
- Rejected for this slice: hierarchical Change Selector tree, All Commands catalog, View Docs, `scrollUntilVisible` / `copyTextFrom`.

## What shipped

**Runner**
- `input` taps to focus whenever `x,y` are present (id/label/description/coords), then types
- `tap` supports `--double` and `--duration` (long-press hold)

**Client (`@yoqa/runner-client`)**
- `ActionRequest.double`; shell format/parse for `--double`

**Desktop**
- Selection-anchored **ElementActionMenu** on the live screenshot:
  - Suggested chips: tap, assertVisible, inputText (input promoted for editable types)
  - Selector Commands: assertVisible / assertNotVisible / tap / doubleTap / longPress / inputText / wait
  - Flyout: Insert & Run, Insert, Copy
- Command bar slimmed to **global** swipe + wait only
- Insert & Run appends lines and executes only those lines against the session

## How to verify

1. Open desktop → **Inspector** → Connect a device.
2. Click an element — highlight + floating menu appear near the selection.
3. Open a suggested command → **Insert** appends `yoqa` lines; **Insert & Run** executes them; **Copy** copies the snippet.
4. Choose **inputText**, enter text, Insert & Run — field focuses and text is typed.
5. Open **Selector Commands** — doubleTap / longPress / asserts work the same way.
6. Double-click still inserts a tap without using the menu.
7. Swipe / wait remain on the right-hand command bar; **Run script** still replays the full editor.

## Follow-ups

- Change Selector (cycle overlapping / parent-child hierarchy)
- All Commands catalog + View Docs links
- `scrollUntilVisible`, `copyTextFrom`, `extendedWaitUntil`
- Save recorded script onto a test case / convert shell ↔ `CaseScript` JSON
- Adaptive poll rate / MJPEG-style stream for lower latency
