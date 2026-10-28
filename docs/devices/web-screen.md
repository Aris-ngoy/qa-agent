# Web: Screen from the accessibility tree

## Goal

Give a web device a real **Screen** ([#304](https://github.com/Aris-ngoy/qa-agent/issues/304), part of [#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). `yoqa screen` returns the cleaned element tree, built from the page's accessibility tree and element boxes, in the same node shape as mobile: type, label, id when there is one, enabled, and bounds on the 0–1000 scale of the page viewport. `yoqa screen --full` returns the raw accessibility tree. `-d` Grounding, tree **Screen mode**, **Tree assist** snapping and Case Script label and id taps all read this tree, so they now work on web too. Vocabulary: **Screen**, **Tree assist**, **Browser device** in [`CONTEXT.md`](../../CONTEXT.md). Lane background: [web-attach-by-port.md](./web-attach-by-port.md), [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **The page source is the raw tree.** The lane's `pageSource` is CDP's `Accessibility.getFullAXTree`, as JSON (`{ "axTree": [...] }`). Each node whose element is laid out also carries `bounds` (viewport CSS pixels), `testId` (`data-testid`) and `domId` (`id`). `--full` returns that JSON unchanged, hidden nodes included.
- **Three commands per read, not one per node.** Boxes and attributes come from a single `DOMSnapshot.captureSnapshot`, joined to the tree by backend node id. Snapshot boxes are in document coordinates, so the document's scroll offset is subtracted. They are also in the display's device pixels, so the result is divided by the scale `Page.getLayoutMetrics` gives: see [web-device-pixel-boxes.md](./web-device-pixel-boxes.md). Rejected: the tracer bullet's `DOM.getBoxModel` per node, which costs one round trip per node on a large page.
- **The cleaner is pure** (`cleanWebAxSource` in `screen.ts`, next to the Android and iOS cleaners). `cleanPageSource` picks it when the JSON has `axTree`.
  - It drops ignored (hidden) nodes, nodes with no layout box, zero-size nodes and offscreen nodes.
  - It drops `RootWebArea`, `InlineTextBox` and `LineBreak` always.
  - It drops any unnamed node unless its role is a control (button, link, textbox, checkbox, option and similar), so a bare icon button still shows.
  - It drops a `StaticText` that its nearest named ancestor already says, such as the text inside a button, link or heading.
  - The type is the ARIA role. The label is the accessible name (whitespace collapsed), or a field's value.
- **id** is `data-testid` first, because React Native Web renders `testID` as `data-testid`, then the DOM `id`. React `useId` values (`:r1:`) change between renders, so they are not used as ids.
- **Clickable is the role.** The mobile node shape has no `clickable` field, and this change does not add one. Tree assist decides "tappable" from the type, and its role pattern now also matches `textbox`, `searchbox`, `combobox` and `option`.
- **Iframes are on the Screen too** ([#360](https://github.com/Aris-ngoy/qa-agent/issues/360)), same-origin and out-of-process; see [Iframes](#iframes) below.
- Rejected: a separate `web-screen.ts` module. The spec puts the cleaner beside the existing cleaners.

## What shipped

- `screen.ts`: `cleanWebAxSource`, the `WebAxSource` page-source type, and dispatch from `cleanPageSource`.
- `web-direct-lane.ts`: `pageSource` reads the AX tree and one DOM snapshot, and joins them by backend node id. The tracer bullet's interim mapping of named nodes is gone.
- `cdp-client.ts`: `DOMSnapshot.captureSnapshot` replaces `DOM.getBoxModel`. `AxNode` also types `value`, `parentId` and `childIds`.
- `runs/agent.ts`: Tree assist snaps onto web fields and list options as well as buttons and links.
- Tests:
  - `fake-cdp.ts` serves the DOM snapshot. Nodes can carry `domId`, `testId` and `hidden`, and the page can be scrolled.
  - `screen.test.ts` has fixture tests on a recorded-shape sign-in page (`fixtures/web-ax-sign-in.json`).
  - `web-direct-lane.test.ts` covers the cleaned and `--full` Screen, a scrolled page, label and id taps, and a Case Script label tap replaying through `executeScriptCase`.
  - The web harness's Lane contract tree case now goes through the new cleaner.

## Iframes

### Goal

A tester sees the controls inside an iframe (a card form, a "Sign in with" button, an embedded live example) and could neither pick them in the Inspector nor tap them by label or id. On the research pages, 10 of the remaining misses per preset were iframe content (`docs/research/web-inspector-picks.md` on the `research/web-inspector-picks` branch). Part of [#339](https://github.com/Aris-ngoy/qa-agent/issues/339), decided in [#348](https://github.com/Aris-ngoy/qa-agent/issues/348).

### Plan summary

- **A process at a time.** A same-origin iframe runs in the page's process. Its document is already in the page's `DOMSnapshot.captureSnapshot`, and its owner element points at it (`contentDocumentIndex`). `Accessibility.getFullAXTree` reads its tree by the document's `frameId`. A cross-site iframe runs in a process of its own under site isolation. The page's session sets `Target.setAutoAttach` (flatten), so each such iframe attaches as a session of its own. That session gives its tree and snapshot, and `DOM.getFrameOwner` on the parent session gives its iframe element. Each iframe session sets auto-attach too, so nested out-of-process frames are read the same way.
- **Boxes in the page viewport.** Each document's boxes are in its own document's device pixels. Its own scroll offset is taken off, the result is divided by the page's device-pixel scale, and it is moved by where the frame's content box starts. That start is the owner's box plus its border (`clientRects`, from `includeDOMRects`) and its padding (computed `padding-left`/`padding-top`), all from the parent's snapshot.
  - Rejected: `DOM.getBoxModel` for the owner. It costs a round trip per frame, and its quads are in another space (the local root's viewport) from the snapshot's, which would need a second conversion.
- **One tree.** Each frame's nodes are spliced into the array right after their owner's node, which is the `Iframe` node. The frame's root gets the owner as its `parentId`, and the owner lists the root in `childIds`, so `--full` and the cleaner see one tree. `cleanWebAxSource` has no new rules: an unnamed `Iframe` node is dropped like any unnamed non-control.
  - An out-of-process frame numbers its nodes from 1 again, so its node ids get its frame id as a prefix (`<frameId>:12`).
  - Backend node ids are only unique within one process, so an owner is looked up among its own process's nodes.
  - A node the tree already holds is not added twice.
- **Taps are unchanged.** They are page coordinates, and the browser hit-tests them into the frame.
- A frame that goes away while it is read, or whose iframe is not laid out, is left off the Screen. It does not fail the read.

### What shipped

- `web-direct-lane.ts`:
  - `attachPage` turns on auto-attach, and the session tracks each out-of-process iframe's session under its parent's.
  - `layoutFrames` replaces `layoutByBackendId`: every document of a snapshot, each at its origin, plus each owner's content box.
  - `frameTree` reads one process's frames and recurses into out-of-process ones. `spliceFrame` hangs each under its owner.
- `cdp-client.ts`: types `Target.setAutoAttach`, `DOM.getFrameOwner`, `getFullAXTree`'s `frameId`, and the snapshot's `frameId`, `contentDocumentIndex`, `clientRects` and `styles`.
- `fake-cdp.ts`: a page can hold `frames`. A same-origin frame is a document in the page's snapshot and process. An out-of-process frame attaches through `Target.setAutoAttach`, with ids that start over. Each frame has its own border, padding and scroll.
- `web-direct-lane.test.ts`, at a 2× display on a scrolled page:
  - A button in each kind of frame is on the Screen with page-relative boxes.
  - Taps by label and id land on them.
  - `--full` is one tree with unique ids.

## How to verify

```bash
bun test services/runner/src/domains/devices/screen.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts
bun test services/runner/src/domains/devices/web-direct-lane.test.ts -t iframes
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "Web Direct"
bun test services/runner/src/domains/runs/agent.test.ts -t snapTapToElement
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome (see [web-attach-by-port.md](./web-attach-by-port.md) for starting it):

```bash
yoqa devices connect chromium-cdp-9222
yoqa action open-url --url https://example.com
yoqa screen                       # heading "Example Domain", the paragraph text, link "More information..."
yoqa screen --full                # the raw AX tree with bounds
yoqa action tap --label "More information..."
```

For iframes, open a page that embeds both kinds, such as a local page with a same-origin `<iframe src="/form.html">` and a cross-site one, or [MDN `<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe). Then check that `yoqa screen` lists the frames' controls where they are drawn, that `yoqa action tap --label` reaches one, and that the Inspector picks them at a 2× display.

## Follow-ups

- Iframes: a frame under a CSS transform or zoom gets an untransformed origin. It has not been checked by hand on a real page with both kinds of frame.
- Labels are not truncated. A long paragraph is one long label, as on mobile.
