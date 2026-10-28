# Research: what the web Inspector can't pick

Ticket [#345](https://github.com/Aris-ngoy/qa-agent/issues/345), under map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339). Code:
- `services/runner/src/domains/devices/web-direct-lane.ts` (`pageSource`, `layoutByBackendId`)
- `services/runner/src/domains/devices/screen.ts` (`cleanWebAxSource`, `pushNormalized`)
- `apps/desktop/src/mainview/features/inspector/utils/selection.ts` (`hitTestElements`)
- `apps/desktop/src/mainview/features/inspector/hooks/use-inspector-feed.ts` (tree refresh)

Vocabulary: **Screen**, **Browser device**, **Viewport preset** in [`CONTEXT.md`](../../CONTEXT.md).

**Status markers:** **[measured]** means observed on this Mac (macOS 27.2, Retina, host DPR 2) on 2026-10-28 with the scripts in [`scripts/`](./scripts/). **[unverified]** means not checked here.

## Answer in short

1. **The biggest cause is not on the ticket's list.** `DOMSnapshot.captureSnapshot` reports `layout.bounds` and `scrollOffsetX/Y` in **device pixels**: the host screen's scale, ×2 on a Retina Mac. `layoutByBackendId` reads them as CSS pixels. **[measured]**
   - **Effect:** on a Mac, every web Screen box is twice as large and twice as far from the top-left. `pushNormalized` then drops whatever lands past the viewport.
   - **How big:** as shipped, the Inspector picks **2 of 320** targets on six pages at both presets.
   - **Also hits Runs:** taps by id or label use the same boxes and miss. A `tap label "Increment"` on the Expo demo resolves to (1000, 954), clamped at the edge, and returns `ok: true`, while the count stays at 0. It does the same headful and headless, at both presets.
   - **Why nobody saw it:** CI runs Linux at DPR 1, where the factor is 1.
   - **Scope:** the same on Chromium 133 (Chrome for Testing) and 156 (Dia), with or without emulation.
2. **With the boxes corrected** (divided by `layoutViewport ÷ cssLayoutViewport` from `Page.getLayoutMetrics`), the Inspector picks **197/220** targets at desktop and **85/100** at mobile. **[measured]** What remains, by cause:

   | Cause | Desktop | Mobile |
   |---|---|---|
   | Inside an iframe (same- or cross-origin) | 10 | 10 |
   | Hit test chose another element | 5 | 1 |
   | Not in the accessibility tree (`alt=""`, `aria-hidden` icons, decorative text) | 5 | 1 |
   | Dropped by `cleanWebAxSource`: unnamed non-control | 2 | 2 |
   | Dropped by `cleanWebAxSource`: text merged into its parent (an inline fragment) | 1 | 1 |
   | Inside shadow DOM | 0 | 0 |
   | **Missed** | **23 / 220** | **15 / 100** |

3. **Timing loses more than the cleaner does.** On hover, the Inspector picks from a tree it reads every 8 s, and on click it re-reads only when the tree is over 3 s old. Reading the tree takes only 2–90 ms (430 ms on MDN's large page). So the tree is late because of that cadence, not because reading it is slow. **[measured]**
   - **After one scroll**, a stale tree picks **77/188** (desktop) and **24/59** (mobile). A fresh one picks **169/188** and **58/59**.
   - **After a screen change** in the app, a stale tree picks **29/47**. A fresh one picks **45/47**.
4. **Compared with mobile.** Mobile Screens keep unnamed views and drop only layout containers (`isLayoutOnly`). The web cleaner drops every unnamed non-control. That cost only 2 picks per preset here, so it is not the lever the map guessed. Frames and freshness are. **[measured]**

## Method

- **Pages:**
  - [TodoMVC React](https://todomvc.com/examples/react/dist/): a React SPA, with three todos added and one checked.
  - [react.dev/learn](https://react.dev/learn): a large React app.
  - The **Expo demo** web export (`examples/expo-demo`, React Native Web).
  - A **local fixture** with an `onclick` div, an unnamed clickable square, an `alt=""` image, an open shadow root, a same-origin iframe and a cross-origin iframe.
  - [MDN `<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe): iframes and web components.
  - [Bootstrap forms](https://getbootstrap.com/docs/5.3/forms/overview/): form-heavy.
- **Browser and Screen:** each page ran on Chrome for Testing 133, headful, at both presets. The Screen came from the **real lane**: `createWebDirectSession` attached by port, its `pageSource()`, and `cleanWebAxSource`.
- **What a tester expects to pick:** a DOM walk over every frame and open shadow root lists three kinds of target. Each is visible, in view, and on top at its centre (`elementFromPoint`).
  - controls (links, buttons, inputs, ARIA widgets, `onclick`, `tabindex`, the topmost `cursor:pointer`),
  - text that is not inside a control,
  - images that are not inside a control.
- **Hit test:** each target's centre goes through the desktop's own `hitTestElements`.
  - **A pick** is a box overlapping the target by IoU ≥ 0.5.
  - A text target also counts when the picked element's label contains its text: hovering `<h3>React</h3>` and getting the heading "React" is right.
  - A role-less clickable `div` counts when its own text is picked, because a tap by that label still works.
- **Sorting a miss:** each target is tagged, and its node is found in the snapshot (`backendNodeId`). Then the raw accessibility tree says why the target missed:
  - no node,
  - an ignored node,
  - no box,
  - a node that `cleanWebAxSource` dropped (and by which rule),
  - or a node on the Screen that the hit test passed over for another element.
- **Two modes:** "as shipped" uses the lane's boxes unchanged. "Corrected" divides them by the device-pixel factor, to see what is left once that bug is fixed.
- **Timing cases:**
  - **Scroll:** a lane `swipe` scrolls about 40 % of the viewport. Fresh targets are then hit-tested against the tree read before the scroll.
  - **Screen change:** TodoMVC's "Completed" filter, or the Expo demo's "Open greeting". The new targets are hit-tested against the tree from before.

## The device-pixel boxes, in detail

[`scripts/dom-snapshot-units.ts`](./scripts/dom-snapshot-units.ts) puts one 100×50 box at (40, 40) CSS px and scrolls the page 100 px **[measured]**:

| | `getBoundingClientRect` | snapshot `layout.bounds` | snapshot `scrollOffsetY` | `offsetRects` (with `includeDOMRects`) | `getLayoutMetrics` CSS / device width |
|---|---|---|---|---|---|
| No emulation (DPR 2) | 40, −60, 100, 50 | 80, 80, 200, 100 | 200 | 40, 40, 100, 50 | 1200 / 2400 |
| Mobile preset (emulated DPR 3) | 40, −60, 100, 50 | 80, 80, 200, 100 | 200 | 40, 40, 100, 50 | 980 / 1960 |
| Desktop preset (emulated DPR 1) | 40, −60, 100, 50 | 80, 80, 200, 100 | 200 | 40, 40, 100, 50 | 1280 / 2560 |

- **The factor:** the host's scale, ignoring the emulated DPR. Bounds and scroll offset share it, so the lane's subtraction stays consistent, and dividing its result by the factor gives CSS pixels.
- **Getting the factor:** `Page.getLayoutMetrics` (`layoutViewport.clientWidth ÷ cssLayoutViewport.clientWidth`). On a tab that never painted (Dia behind its sign-up wall), it returned 0 / 0. The fix needs a fallback, such as `contentWidth` against the page's `scrollWidth`. **[measured]**
- **Same on:** headless (`--headless=new` also reports DPR 2 on this Mac), and Chromium 156 (Dia).

Picks as shipped (targets picked / targets):

| Page | Desktop | Mobile |
|---|---|---|
| TodoMVC React | 0/31 | 0/14 |
| react.dev | 0/38 | 0/22 |
| Expo demo | 0/5 | 1/5 |
| Frames + shadow fixture | 0/19 | 1/19 |
| MDN `<iframe>` | 0/63 | 0/25 |
| Bootstrap forms | 0/64 | 0/15 |

## What remains once boxes are corrected

| Page | Desktop | Mobile | Misses (main frame) |
|---|---|---|---|
| TodoMVC React | 31/31 | 14/14 | none |
| react.dev | 37/38 | 21/22 | a decorative `<svg>` icon, unnamed (cleaner) |
| Expo demo | 5/5 | 5/5 | none |
| Frames + shadow fixture | 7/19 | 7/19 | all 10 iframe targets; the unnamed clickable square (cleaner); the `alt=""` image (not in tree). All 3 shadow-DOM targets picked |
| MDN `<iframe>` | 57/63 | 23/25 | "Switch color theme" button loses to its smaller "Theme" text; "Try it" link loses to a larger region with the same name; two tab-panel containers lose to inner text; an inline `<code>` inside a sentence; an `aria-hidden` paragraph |
| Bootstrap forms | 60/64 | 15/15 | three `aria-hidden` `<svg>` icons (not in tree); the "Bootstrap" brand link picks the "Grid" link that overlaps it |

- **Iframes are the one structural gap.**
  - `getFullAXTree` reads the main frame only, and so does `layoutByBackendId`, which reads `documents[0]`.
  - A cross-origin iframe is also its own CDP target (an out-of-process frame), so it needs a session of its own.
  - A tester sees those controls and cannot pick or tap them. That's 10 of 19 targets on the fixture.
  - On MDN, the live-example iframe sits inside a web component and showed no reachable targets [unverified why].
- **Shadow DOM is fine.** The accessibility tree and the snapshot both follow the flat tree.
- **Hit-test misses are small and real:**
  - A smaller element wins when it sits *inside* a control: "Theme" inside "Switch color theme".
  - A sibling with a larger box overlaps a link: Bootstrap's "Grid" over "Bootstrap".
  - `hitTestElements` prefers the smallest box that has a selector. That is right on mobile, and wrong when a control's own text node is also on the Screen.

## Timing

Targets picked with the tree the Inspector had cached, against a tree read just then (corrected boxes) **[measured]**:

| Case | Page | Stale tree | Fresh tree |
|---|---|---|---|
| Scroll | react.dev | 21/58 · 7/23 | 56/58 · 23/23 |
| Scroll | MDN | 11/64 · 8/22 | 51/64 · 21/22 |
| Scroll | Bootstrap | 45/66 · 9/14 | 62/66 · 14/14 |
| Screen change | TodoMVC "Completed" | 20/29 · 5/12 | 27/29 · 12/12 |
| Screen change | Expo "Open greeting" | 2/3 · 2/3 | 3/3 · 3/3 |

(desktop · mobile)

Tree read time (`pageSource`): Expo 3–10 ms, TodoMVC 6–16 ms, Bootstrap 43–45 ms, react.dev 71–88 ms, MDN 404–437 ms. The tree is cheap enough to re-read after every frame change or action, and not only every 8 s.

## Recommendation

1. **Fix the device-pixel boxes first. This is a bug, not a design question.**
   - Divide `layoutByBackendId`'s bounds by the device-pixel factor.
   - Add a Lane contract case with `FakeCdp` at a device scale of 2. The fake today returns CSS-pixel boxes, which is why the suite passes.
   - Runs on a Mac are broken by the same bug, so it should not wait for the web-testing ADR.
2. **Read iframes.** Call `getFullAXTree` per frame (`frameId`), and reach out-of-process frames through `Target.setAutoAttach` sessions. Offset each frame's boxes by its owner's content box (`DOM.getFrameOwner` + `DOM.getBoxModel`). Taps inside a frame then work too, since they are page coordinates.
3. **Keep the tree fresh.**
   - Re-read the Screen after each Inspector action and on scroll: `Page.frameNavigated` / `lifecycleEvent`, or a cheap DOM mutation or scroll signal.
   - Cut the hover cache to the frame's age instead of 8 s.
   - With a screencast Frame Feed ([#344](https://github.com/Aris-ngoy/qa-agent/issues/344)), each frame's arrival can drive a debounced tree read.
4. **Small cleaner and hit-test fixes.** These are worth one ticket together, not more:
   - drop a `StaticText` when its parent control is on the Screen, even when the control's name differs in case or adds words ("Theme" inside "Switch color theme");
   - keep unnamed images that carry a `data-testid` or `id`.
   - Leave `aria-hidden` content out. A tester can still pick it by coordinates.

## How to reproduce

```bash
bun docs/research/scripts/web-inspector-picks.ts mobile          # as shipped
CORRECT=1 bun docs/research/scripts/web-inspector-picks.ts desktop react-dev mdn-iframe
bun docs/research/scripts/dom-snapshot-units.ts "<chrome executable>" headful
bun docs/research/scripts/web-tap-by-label.ts headless
```

The audit needs the Expo demo exported into the scratch path at the top of the script (`npx expo export --platform web --output-dir …`). The raw reports, with every miss and what was picked instead, are in `scripts/web-inspector-picks-*.json`.

## Follow-ups

- **The device-pixel bug fix** (lane + `FakeCdp` contract case). It blocks reliable web Runs on any Retina Mac.
- **Frame-aware Screen** (iframes) and a **fresher tree.** Both are inputs to the map's ADR.
- **Not measured:** Windows hosts at 125–150 % scaling (the factor would be 1.25–1.5), and Google Chrome stable.
