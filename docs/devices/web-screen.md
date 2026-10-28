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

## How to verify

```bash
bun test services/runner/src/domains/devices/screen.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts
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

## Follow-ups

- Same-origin iframes: `getFullAXTree` reads the main frame only, so content inside an iframe is not on the Screen yet.
- Labels are not truncated. A long paragraph is one long label, as on mobile.
