# Inspect & App Control

Shared debug commands: screenshots, screen inspection, app lifecycle, and alerts. Act by explicit
relative coordinates read off a screenshot — see [Actions by coordinates](actions-coordinates.md).
`--id` / `--label` / `--description` are the fallback — see [Targeting elements](actions-grounding.md).

## Screenshot first

```bash
yoqa screenshot /tmp/screen.png    # save a screenshot to file, then open the image and look at it
```

**Always take a screenshot before and after any action to verify the actual UI state.**

**Look at the screenshot first — it is the primary way to read the screen.** It shows what the user
sees: layout, icons, canvas and game controls, overlays, the soft keyboard, and **system sheets and
dialogs** (App Store "Install", permission prompts, share sheets). Decide from the image, then act with
`--x` / `--y`. The command prints the saved path; open that file as an image — do not try to read it as
text.

Do not trust the element list over the screenshot. The element list can miss a system sheet that is
covering the app and keep describing the screen underneath it, so a tree that says "Preparing to
download" can sit under a sheet whose only button is "Install". When the two disagree, the screenshot
is right.

## Screen inspection (fallback)

```bash
yoqa screen                        # cleaned element list
yoqa screen --json                 # same list as JSON — includes each element's id, type, enabled, visible
yoqa screen --full                 # raw accessibility tree (JSON-wrapped, very long)
```

Use `yoqa screen` when the screenshot is not enough: you need an exact label or `--id` to target
deterministically, text is too small to read, or you want the list of everything on a long screen. It
costs fewer tokens than an image but sees only the app's own accessibility tree.

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

**On web** the screenshot is the page's viewport (no browser tabs or address bar), and `yoqa screen`
is the page's accessibility tree with the same output shape: labels are accessible names, and `--id` is
the element's `data-testid`, else its `id`. Bounds are relative to the viewport, so anything scrolled
out of view is offscreen and dropped.

## App lifecycle

The flag is `--app-id` (iOS bundle id, Android application id, or on web the App's Web URL):

```bash
yoqa action activate-app --app-id com.example.app
yoqa action terminate-app --app-id com.example.app
yoqa action restart-app --app-id com.example.app     # terminate, then activate
yoqa action background-app                            # background for 3s (default)
yoqa action background-app --seconds 10
yoqa action open-url --url "https://example.com"
```

On web an app is its **Web URL** (`http` or `https`), and each lifecycle Action acts on the page:

| Action | On web |
|---|---|
| `open-url` | navigates the page to the URL |
| `activate-app` | brings a page already on the URL's origin to the front, or navigates to the URL |
| `terminate-app` | closes the app's page; the session moves to a blank page |
| `restart-app` | closes the page, clears all storage and cookies for the origin, then loads the URL fresh |
| `background-app` | **not supported** — fails with "background-app is not supported on web" |

```bash
yoqa action open-url --url "http://localhost:8081/settings"
yoqa action restart-app --app-id http://localhost:8081
```

A link or script that opens a new tab or popup (`target=_blank`, `window.open`, an OAuth sign-in
window) is followed: the next screenshot and Action are on the popup. When the popup closes, the
session returns to the page that opened it. There is no tab switching; tabs the page did not open are
ignored.

## Alert

Prefer the `alert` command over tapping a button when interacting with a system alert. Accept is the
default; pass `--dismiss` to dismiss.

```bash
yoqa action alert              # accept
yoqa action alert --dismiss    # dismiss
```

On web, `alert` answers the page's JavaScript dialog (`alert`, `confirm`, `prompt`, or a "Leave
site?" prompt). It fails with "No JavaScript dialog is open on the page" when there is none.

## Keys

`yoqa action key` presses one named key on the focused element, optionally with modifiers held. Use it
to submit a form (Enter), move focus (Tab, Shift+Tab), close a modal or menu (Escape), and move through
a list or combobox (arrows). Keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown,
ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space. Modifiers: Shift, Control, Alt, Meta. Names
are case-insensitive.

```bash
yoqa action key Enter
yoqa action key Tab --modifiers shift          # Shift+Tab
yoqa action key ArrowDown --screenshot
```

What each platform can press:

| Platform | Keys | Modifiers |
|---|---|---|
| Web | all | yes |
| Android | all (modifiers need Android 13 or later) | yes |
| iOS simulator | all | no |
| Physical iPhone | Enter, Backspace, Space | no |

A key the device cannot press fails the Action with an error naming the key and what the device
supports. Nothing is sent, so choose another way (tap the on-screen Return or Next button) rather than
retrying.
