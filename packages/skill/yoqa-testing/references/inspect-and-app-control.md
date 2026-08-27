# Inspect & App Control

Shared debug commands: screen inspection, app lifecycle, and alerts. To act on an element, target it
by `--id`/`--label`/`--description` — see [Targeting elements](actions-grounding.md) — or by explicit
relative coordinates — see [Actions by coordinates](actions-coordinates.md).

## Screen inspection

```bash
yoqa screen                        # cleaned element list (primary way to read the screen)
yoqa screen --json                 # same list as JSON — includes each element's id, type, enabled, visible
yoqa screen --full                 # raw Appium page source (JSON-wrapped, very long)
yoqa screenshot /tmp/screen.png    # save a screenshot to file, to visually verify
```

**Always inspect before and after any action to verify the actual UI state.**

**Prefer `yoqa screen` first — it is the primary way to read the screen.** The element list is far
cheaper in tokens than an image and is enough to understand the UI in most cases. Only fall back to
`yoqa screenshot` when the list is not enough: it comes back empty, it lacks the information you need,
or you can't tell what's actually rendered (custom drawing, images, visual layout/overlap). Use the
screenshot to fill that gap, not as the default way to look at the screen.

Call `yoqa screen` directly — do not pipe through `grep`, `awk`, or any other filter. Parse the raw
output yourself. Filtering can hide elements you need.

### Reading the output

Default output is one line per element:

```
   x,   y  WIDTHxHEIGHT  label
 460, 901  120x38  Login
```

All four numbers are **relative, `0–1000` on both axes** — not pixels. `x` increases left→right, `y`
increases top→bottom, and **`x,y` is the element's top-left corner, not its centre**. To tap the
centre of an element:

```
centre_x = x + width / 2
centre_y = y + height / 2
```

Elements with no accessible label show an empty label — those are only reachable by coordinates, or by
`--id` if they carry an identifier.

**`--id` needs `yoqa screen --json`.** The default output does not print identifiers; the JSON does
(`id`, plus `type`, `enabled`, `visible`). Read ids from there when you want deterministic targeting.

Layout-only containers, zero-size nodes, offscreen nodes, and elements marked invisible are dropped
from the cleaned list. If an element you expect is missing, it is one of those — check
`yoqa screen --full` before concluding it isn't rendered.

## App lifecycle

The flag is `--app-id` (iOS bundle id or Android application id):

```bash
yoqa action activate-app --app-id com.example.app
yoqa action terminate-app --app-id com.example.app
yoqa action restart-app --app-id com.example.app     # terminate, then activate
yoqa action background-app                            # background for 3s (default)
yoqa action background-app --seconds 10
yoqa action open-url --url "https://example.com"
```

## Alert

Prefer the `alert` command over tapping a button when interacting with a system alert. Accept is the
default; pass `--dismiss` to dismiss.

```bash
yoqa action alert              # accept
yoqa action alert --dismiss    # dismiss
```
