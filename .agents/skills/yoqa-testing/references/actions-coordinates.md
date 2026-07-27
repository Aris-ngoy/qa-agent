# Actions by Coordinates (fallback)

**Fallback path — prefer [Actions by description](actions-grounding.md) (grounding).** Grounding is the primary approach: you describe the element and YoQA locates it. Use coordinates only when grounding isn't a good fit — e.g. it keeps mislocating a target, or you already know the exact spot (a point on a map/canvas with no distinct element to describe).

Here **you** locate the element and pass its coordinates — YoQA performs no resolution. Coordinates are relative (`0–1000`). X increases left→right, Y increases top→bottom. Read them from the `relative_bbox_2d` of the target element in `yoqa screen` — see [Inspect & App Control](inspect-and-app-control.md).

**Always `yoqa screen` first** to find the element and compute its center; never guess coordinates.

### Tap
```bash
yoqa action tap --x <x> --y <y> [--double] [--duration <seconds>]
```
```bash
yoqa action tap --x 500 --y 926
yoqa action tap --x 500 --y 926 --double
yoqa action tap --x 500 --y 926 --duration 2
```

### Swipe
```bash
yoqa action swipe --x1 <x1> --y1 <y1> --x2 <x2> --y2 <y2>
```
```bash
yoqa action swipe --x1 500 --y1 700 --x2 500 --y2 300
```

### Drag
```bash
yoqa action drag --x1 <x1> --y1 <y1> --x2 <x2> --y2 <y2>
```
```bash
yoqa action drag --x1 200 --y1 500 --x2 800 --y2 500
```

### Input text
```bash
yoqa action input --text <text> --x <x> --y <y>
```
```bash
yoqa action input --text "hello world" --x 500 --y 420
```
