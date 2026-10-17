# Resizable device panels and the screenshot viewer

## Goal

- Let people resize the Inspector's **Device** panel by dragging, so the live device can be bigger than the small, height-capped picture it was.
- On a Run's detail page, fit the device frame to the screenshot (no empty bands), keep the Screenshot panel in place while the step list scrolls, make it resizable, and open screenshots in a viewer that zooms, pans and rotates.

## Plan summary

- **One splitter for both pages.** `app/resize/` holds a `ResizeHandle` (a `role="separator"` that drags, steps with the arrow keys, and resets on double-click) and `usePanelWidth`, which remembers each width in `localStorage`. The step list (Runs) and the script (Inspector) always keep a minimum width, so a stored width can't squeeze them out.
- **Inspector device fills the panel's width.** The old cap (`100vh - 27rem`) meant a wider panel never showed a bigger device. The cap is now `100vh - 9rem`, so the whole device still fits the window, and the panel column scrolls when the device and its controls are taller than the window. Narrow the panel to shrink the device. A separate fit-height / fill-width toggle was considered and left out to keep one control.
- **Run frame takes the screenshot's own shape.** The frame used to be a fixed `9 / 19.5` box with `object-contain`, which letterboxed any screenshot of a different shape, and the bezel border took space from the screen. The screenshot's real size is now read when it loads (`frameAspect`), and the bezel wraps a screen box with exactly that shape. A web Run uses its Viewport preset until the first screenshot loads. The frame is as wide as the panel but never taller than the window.
- **Screenshot panel stays in place.** The steps row was a wrapping flex row with `items-start`, so the step list grew to its full height and the whole page scrolled, taking the screenshot with it. The row no longer wraps; the step list scrolls by itself, which `useFollowLatest` already expected.
- **Viewer is a HeroUI `Modal` (`size="cover"`).** The zoom and pan maths lives in `features/runs/viewer-zoom.ts` (pure, unit-tested); `screenshot-viewer.tsx` only handles events. The zoom level carries over between steps so you can compare the same spot from step to step.

## What shipped

- Drag splitter between the Inspector's Device and Script panels, and between a Run's steps and its Screenshot panel. Arrow keys / Shift+arrows / Home / End work once the splitter has focus, double-click resets it, and each page remembers its width.
- Inspector device image grows with the panel width (up to the window height).
- Run screenshot frame shaped to the screenshot, edge to edge, capped to the window height; the panel stays put while steps scroll.
- Click the Run screenshot (or the expand icon that shows on hover) to open the **screenshot viewer**:
  - scroll or pinch to zoom around the cursor, drag to pan, double-click to zoom in at the cursor or back to fit;
  - toolbar buttons for zoom in/out, the zoom as a share of real pixels, **Fit**, **1:1** (actual pixels), and rotate left/right (re-fits for landscape);
  - keys: `+`/`-`, `0` fit, `1` actual pixels, `R`/`Shift+R` rotate, `←`/`→` previous/next step (review mode), `Esc` close.

## How to verify

1. `bun test apps/desktop/src/mainview/app/resize apps/desktop/src/mainview/features/runs/viewer-zoom.test.ts`
2. In the desktop app, open **Inspector** with a connected device: drag the bar between Device and Script; the device grows and shrinks. Reload: the width is kept. Double-click the bar to reset it.
3. Open a finished Run: the device frame has no dark bands around the screenshot. Scroll the step list; the screenshot stays put. Drag the bar to resize the panel.
4. Click the screenshot: the viewer opens. Scroll to zoom, drag to pan, use ← → to change step, press `R` to rotate, `0` to fit, `Esc` to close.

## Follow-ups

- The Inspector's live frame could open the same viewer (frozen frame) for close inspection.
