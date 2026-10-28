# Web Screen boxes in CSS pixels on high-DPI displays

## Goal

Fix web Screens on any display that isn't 1×, such as every Retina Mac. Chromium's `DOMSnapshot.captureSnapshot` reports layout boxes and scroll offsets in the **display's device pixels**, whatever the page emulates. The web Direct lane read them as CSS pixels. On a Retina Mac every box came out twice as large and twice as far from the top-left, which caused three problems:
- The Inspector picked 2 of 320 elements on six real pages.
- Taps by id or label missed: `tap label "Increment"` on the Expo demo returned `ok: true` and did nothing.
- `pushNormalized` dropped elements pushed past the viewport.

CI runs Linux at 1×, so the suite never saw it. Found while researching [#345](https://github.com/Aris-ngoy/qa-agent/issues/345), with measurements on the `research/web-inspector-picks` branch (`docs/research/web-inspector-picks.md`). Background: [web-screen.md](./web-screen.md), and **Screen** and **Viewport preset** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **The scale.** Divide each snapshot box, after the scroll offset is taken off, by device pixels per CSS pixel. `Page.getLayoutMetrics` gives that ratio: the layout viewport's width in device pixels against its width in CSS pixels. Measured as the host scale (2 on Retina), unchanged by emulation, on Chromium 133 and 156, headful and headless.
- **The fallback.** A tab that has never painted (Dia behind its sign-up wall) reports 0 for both widths. The snapshot is then taken with `includeDOMRects`, and the first box whose element has a CSS offset box gives the ratio. If neither works, the ratio is 1, which was the old behaviour.
- **Rejected alternatives:**
  - The page's `devicePixelRatio`: under a Viewport preset it is the emulated DPR (3 or 1), not the display's.
  - `offsetRects` alone: they are relative to the offset parent, not the viewport.
  - `DOM.getBoxModel` per node: one round trip per node.

## What shipped

- **`web-direct-lane.ts`:**
  - `pageSource` reads the accessibility tree, the snapshot (now with `includeDOMRects`) and `Page.getLayoutMetrics` in parallel.
  - `devicePixelsPerCss` picks the ratio, with the fallback.
  - `layoutByBackendId` divides each box by it.
- **`cdp-client.ts`:**
  - types `Page.getLayoutMetrics`, `includeDOMRects` and `offsetRects`;
  - documents that snapshot boxes are in device pixels.
- **`fake-cdp.ts`, now as Chromium:**
  - snapshot boxes and scroll offsets at the display's `deviceScaleFactor`;
  - `Page.getLayoutMetrics`, and CSS `offsetRects` on request;
  - an `unpainted` option that zeroes the layout metrics.
  - With these changes alone, eight existing tests failed the way a Retina Mac does.
- **Tests:**
  - a Lane contract case per Viewport preset on a 2× display: the Screen is in CSS pixels, and a tap by label lands on the element;
  - a lane test for an unpainted, scrolled tab.

## How to verify

- `bun test services/runner/src/domains/devices/web-direct-lane.test.ts services/runner/src/domains/devices/lane-contract.test.ts`
- **On a Retina Mac,** connect a web device to the Expo demo's web export (see [expo-demo-web-e2e.md](./expo-demo-web-e2e.md)), then run `yoqa action tap --label Increment`. The count goes up. In the desktop Inspector, hovering a control outlines that control.
- **Checked before the PR** on Chrome for Testing 133, headful and headless, both presets:
  - the Expo tap by label now resolves to (500, 477) and increments the count;
  - the pick audit from #345 picks 14/14 on TodoMVC and 59/64 on Bootstrap forms, against 0 before;
  - Dia (Chromium 156) behind its sign-up wall returns the CSS box of a test button.

## Follow-ups

- Windows at 125–150 % scaling (a ratio of 1.25–1.5) is not measured.
- What the Inspector still misses once boxes are right is out of scope here: iframes, and a hover tree up to 8 s old ([#345](https://github.com/Aris-ngoy/qa-agent/issues/345)).
