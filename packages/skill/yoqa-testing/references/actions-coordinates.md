# Actions by Coordinates

Rung 1 of the [targeting ladder](../SKILL.md#targeting-ladder). Coordinates are relative, `0–1000` on
both axes: X increases left→right, Y top→bottom, `0,0` is the top-left of the screen and `1000,1000`
the bottom-right.

Read the point off a screenshot of the **current** screen and send the **centre of the control**:
halfway between its left and right edges, halfway between its top and bottom edges.

### See the result: `--screenshot`

Add `--screenshot` to any `yoqa action` and the action waits for the screen to settle, then prints the
**result screenshot** — no separate `yoqa screenshot` needed. **Always pass it on games and canvases.**

```bash
yoqa action tap --x 500 --y 926 --screenshot [--settle <ms>]
# ok tap
# screenshot /…/result_….png        raw image: open this to read the next point from
# marked /…/result_marked_….png     same image with a ring where the tap landed (line for swipe/drag)
# settled true (500ms)
# changed true
```

- Open `marked` to check **where** the tap landed relative to the control. Read the next point off the raw `screenshot`.
- `changed false` on a settled screen means the tap did nothing: a miss.
- `settled false` / `changed unknown` means the screen was still animating at the cap (default 1500ms, `--settle <ms>` to change). That is normal on games with looping backgrounds. Judge from the image and the marker, not from `changed`.
- A game that animates constantly cannot be tapped on a moving target this way (a round trip takes seconds). Use a Case Script for timing-sensitive play.

If you are reading `yoqa screen` instead of a screenshot, its listed `x,y` is the element's
**top-left corner**, so aim at its centre: `x + width / 2`, `y + height / 2`.

### Tap

```bash
yoqa action tap --x <x> --y <y> [--double] [--duration <ms>]
```
```bash
yoqa action tap --x 500 --y 926
yoqa action tap --x 500 --y 926 --double
yoqa action tap --x 500 --y 926 --duration 2000     # long-press, MILLISECONDS
```

### Swipe

Coordinates only. `--x --y` is where the finger goes down, `--x2 --y2` where it lifts.

**The swipe direction is the finger's movement, which is the opposite of the scroll direction.** To
scroll **down** the page (reveal content below), swipe **up** — from a higher `y` to a lower `y`.

```bash
yoqa action swipe --x <x> --y <y> --x2 <x2> --y2 <y2> [--duration <ms>]
```
```bash
yoqa action swipe --x 500 --y 700 --x2 500 --y2 300      # scroll down (finger moves up)
yoqa action swipe --x 500 --y 300 --x2 500 --y2 700      # scroll back up
```

On web, coordinates are relative to the page viewport, not the browser window. Under the `desktop`
viewport preset a swipe is a mouse-wheel scroll of whatever is under the start point, in the same
direction a finger swipe would scroll (swipe up scrolls down). Under the `mobile` preset it is a real
touch stroke. Tap and drag are mouse presses on `desktop` and touches on `mobile`.

### Drag

```bash
yoqa action drag --x <x> --y <y> --x2 <x2> --y2 <y2> [--duration <ms>]
```
```bash
yoqa action drag --x 200 --y 500 --x2 800 --y2 500
```

### Input text

```bash
yoqa action input --text <text> --x <x> --y <y>
```
```bash
yoqa action input --text "hello world" --x 500 --y 420
```

The point is tapped first to focus the field, then the text is typed. A newline in the text presses
Enter. For other keys (Tab, Escape, arrows) use `yoqa action key` — see
[Inspect & App Control](inspect-and-app-control.md#keys).

### Batch

When every next Action is known and nothing needs a look between them, send them in one call. The
steps run in order, stop at the first failure, and one result screenshot comes back at the end.

```bash
yoqa action batch ./steps.json
```

```json
[
  { "kind": "tap", "x": 500, "y": 380 },
  { "kind": "input", "text": "ada@example.com" },
  { "kind": "key", "key": "Tab" },
  { "kind": "input", "text": "s3cret", "label": "Password" },
  { "kind": "tap", "id": "submit" }
]
```

`kind` is any `yoqa action` name. A step targets by `x` / `y` (plus `x2` / `y2` for swipe and drag),
`id` or `label`; a `description` step is rejected, because grounding needs a fresh screen. Other step
fields: `text`, `durationMs`, `double`, `key`, `modifiers`, `appId`, `url`. Omit the file to read the
JSON from stdin. On failure the output names `failedIndex`, counted from 0.
