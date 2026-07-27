# Manual UI Inspector (script-first)

## Goal

Give desktop users an Appium Inspector–style surface for **manual end-to-end testing**: connect a device, select elements on a live screenshot, build a runnable `yoqa action` / `sleep` shell script, and replay it against the active session.

## Plan summary

- **Script format:** Bash-style lines (`yoqa action …`, `sleep N`), same dialect as exported case scripts — not classic WebDriver locators.
- **MVP shape:** Script editor is the primary surface; screenshot/select exists to **record** lines, then **Run** replays via the runner HTTP API (no shelling out to the CLI).
- Rejected for this slice: hierarchical XML tree, locator generation, save-to-test-case, freehand gesture recording.

## What shipped

**Runner**
- `GET /screenshot/image` — streams a live PNG from the active interactive session (for `<img src>`).

**Client (`@yoqa/runner-client`)**
- `getScreenshotImageUrl()` / `fetchScreenshotBytes()`
- `parseYoqaShellScript`, `formatActionShellLine`, `formatSleepShellLine`, `runYoqaShellScript`, `DEFAULT_SHELL_SCRIPT_HEADER`
- Exported `ScreenElement` type

**Desktop**
- Side nav **Inspector** → `/inspector` (replaces Builds placeholder)
- Session toolbar: platform, device picker, Connect / Disconnect / Refresh
- Screenshot panel with cleaned-tree overlays and click-to-select
- Command bar: Add tap / input / swipe presets / wait
- Script editor + Run / Stop / log + Copy / Export `.sh`
- Non-blocking warning when a catalog run is live (separate Appium session)

## How to verify

1. Open desktop → **Inspector**.
2. Select platform + device → **Connect** (optionally with app bundle/package from Configuration).
3. Confirm screenshot loads; click an element → highlight + selection label.
4. **Add tap** / swipe / wait → lines appear in the script editor.
5. **Run script** → log shows per-line progress; screen refreshes after steps.
6. **Copy** / **Export .sh** and optionally run the same lines with the CLI against a connected device.

## Follow-ups

- Save recorded script onto a test case / convert shell ↔ `CaseScript` JSON
- Hierarchical page-source tree + attribute inspector
- Locator strategies (`findElement`)
- Gesture draw-to-record on the canvas
- Auto-poll screenshot while idle
