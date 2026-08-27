# Actions by Coordinates

Coordinates are relative, `0–1000` on both axes. X increases left→right, Y increases top→bottom, and
`0,0` is the top-left of the screen. Read them from `yoqa screen` — see
[Inspect & App Control](inspect-and-app-control.md). Remember the listed `x,y` is the element's
**top-left corner**, so aim at its centre: `x + width / 2`, `y + height / 2`.

**Always `yoqa screen` first** to locate the element and compute its centre; never guess coordinates.

For **tap** and **input**, prefer [`--id` / `--label` / `--description`](actions-grounding.md) — you
don't compute anything and the command re-reads the tree itself. Use coordinates for tap/input when
the element has no label and no id, or when you already know the exact spot (a point on a map or
canvas with no distinct element to target).

For **swipe** and **drag** coordinates are the only option — those two commands do not accept
`--id`, `--label`, or `--description`.

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

The point is tapped first to focus the field, then the text is typed.
