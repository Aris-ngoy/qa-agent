# Workflow: Debug Directly on Device

You drive the device yourself — look, act, verify. **Look at a screenshot and act by `--x` / `--y`**
([Actions by coordinates](../references/actions-coordinates.md)); that works on every control, including
custom-drawn UI, games, and system sheets. Fall back to `--id` or `--label`
([Targeting elements](../references/actions-grounding.md)) when you know the identifier or coordinates
keep missing, and to `--description` grounding when there's nothing stable to match. Swipe and drag are
always coordinates.

### 1. Connect a device

List available devices and connect one — `--platform` is required for phones and simulators. To test
a web app, connect an installed browser (`yoqa devices web`), with `--viewport mobile` for a React
Native Web / Expo web build. See [Devices](../references/devices.md). If connecting fails, run
`yoqa doctor --fix` ([Environment](../references/environment.md)).

### 2. Make sure the app is on the device

How much you set up here depends on **why** you're debugging:

- **Exploring or fixing something** — whatever's already installed is fine. If the app is installed and
  running (e.g. React Native via Metro, or installed manually), skip to step 3.
- **Developing a test case before writing it** (see [Test Cases & Reusable Flows](test-cases.md)) — start
  from a **clean state** so your walkthrough matches how a saved run executes (every saved run reinstalls
  the app from the build). Don't rely on leftover state from a prior session. Reset first:
  [Install iOS](../references/install-ios.md#clean-install-reset-app-state) ·
  [Install Android](../references/install-android.md#clean-install-reset-app-state).

To get the app onto the device:
**Get the build** — ask the user for the path to the binary. If they don't have one, build it first:
[iOS Native Builds](../references/builds-ios-native.md) ·
[React Native Builds](../references/builds-react-native.md) ·
[Android Builds](../references/builds-android.md).
**Install the build** — [iOS](../references/install-ios.md) · [Android](../references/install-android.md).
**Launch the app** — `yoqa action activate-app --app-id <bundle-id>`. See
[Inspect & App Control](../references/inspect-and-app-control.md).

**On web** there is nothing to install: open the app's URL with
`yoqa action open-url --url <web-url>` (the App's Web URL from `yoqa apps get APP`, or the dev server
the user names). For a clean state, `yoqa action restart-app --app-id <web-url>` clears the origin's
storage and cookies, then loads the URL.

### 3. Screenshot → act → verify

Drive the UI as a loop — never fire an action blind:

1. **Look** — `yoqa screenshot /tmp/screen.png`, then open the image to confirm the target is visible
   and the UI is in the expected state. See
   [Inspect & App Control](../references/inspect-and-app-control.md).
2. **Act** — perform one action at the **centre of the control** you see, with `--x` / `--y`. Use
   `--id` or `--label` only when you already know the identifier (see step above for the fallbacks).
3. **Verify** — take a fresh screenshot and look at it. For text that must appear, also run
   `yoqa assert visible -t "<expected text>"` (or `not-visible`); it waits for the condition and exits
   non-zero if it never holds. See [Assertions](../references/assertions.md).
4. Repeat for the next action.

A worked step:

```bash
yoqa screenshot /tmp/screen.png                 # open it: the Login button is centred near y 860
yoqa action tap --x 500 --y 860
yoqa screenshot /tmp/screen.png                 # open it: the Welcome screen is showing
yoqa assert visible -t "Welcome back"
```

The same loop on web, from connect to a submitted form:

```bash
yoqa devices connect web-chrome --viewport mobile
yoqa action open-url --url http://localhost:8081
yoqa screenshot /tmp/screen.png                 # open it: the Email field is near y 380
yoqa action input --text "ada@example.com" --x 500 --y 380
yoqa action key Tab                             # focus moves to Password
yoqa action input --text "s3cret" --x 500 --y 470
yoqa action key Enter --screenshot              # submit, then open the result screenshot
yoqa assert visible -t "Welcome back"
yoqa screen --json                              # fallback: the page's accessibility tree, for --id / --label
```

On web a swipe scrolls the page, `alert` answers a JavaScript dialog, a popup the page opens (OAuth
sign-in, `target=_blank`) is followed automatically, and `background-app` fails as unsupported. See
[Inspect & App Control](../references/inspect-and-app-control.md).

If a tap changes nothing, don't repeat the same point — take a fresh screenshot and adjust. The target
may be offscreen (scroll to it first), covered by a system sheet or dialog (act on the sheet), or on a
screen you haven't reached. After two misses, read `yoqa screen --json` and use `--id` or `--label`.

App lifecycle, `open-url`, and alert handling are covered in
[Inspect & App Control](../references/inspect-and-app-control.md).

### 4. Release the device

When you're done, `yoqa devices disconnect` so the device is free for the next run. On web this also closes
the browser window Yoqa opened.
