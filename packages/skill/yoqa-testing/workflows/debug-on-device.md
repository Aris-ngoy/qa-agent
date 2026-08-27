# Workflow: Debug Directly on Device

You drive the device yourself — inspect, act, verify. Target elements by `--id` or `--label` read off
the screen tree ([Targeting elements](../references/actions-grounding.md)); those are deterministic and
need no AI provider. Fall back to `--description` grounding when there's nothing stable to match, and to
explicit relative coordinates for swipe/drag or unlabeled elements
([Actions by coordinates](../references/actions-coordinates.md)).

### 1. Connect a device

List available devices and connect one — `--platform` is required. See
[Devices](../references/devices.md). If connecting fails, run `yoqa doctor --fix`
([Environment](../references/environment.md)).

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

### 3. Inspect → act → assert

Drive the UI as a loop — never fire an action blind:

1. **Inspect** — `yoqa screen` to confirm the target is present and the UI is in the expected state.
   Add `--json` when you need element ids. See
   [Inspect & App Control](../references/inspect-and-app-control.md).
2. **Act** — perform one action, targeting by `--id` or `--label` from what you just read; fall back to
   `--description`, then coordinates. Swipe and drag are always coordinates.
3. **Verify** — `yoqa assert visible -t "<expected text>"` (or `not-visible`). It waits for the condition
   and exits non-zero if it never holds, which is a real check rather than an eyeball on a tree dump. See
   [Assertions](../references/assertions.md). Take a `yoqa screenshot` as well when the thing you need to
   confirm is visual (layout, images, custom drawing).
4. Repeat for the next action.

A worked step:

```bash
yoqa screen
yoqa action tap --label "Login"
yoqa assert visible -t "Welcome back"
```

If a target isn't found, don't retry the same selector — re-run `yoqa screen` and pick a selector from
the fresh output. The element may be offscreen (scroll to it first), unlabeled (use `--id` or
coordinates), or on a screen you haven't reached.

App lifecycle, `open-url`, and alert handling are covered in
[Inspect & App Control](../references/inspect-and-app-control.md).

### 4. Release the device

When you're done, `yoqa devices disconnect` so the device is free for the next run.
