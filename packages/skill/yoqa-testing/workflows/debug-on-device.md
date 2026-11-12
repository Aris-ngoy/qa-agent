# Workflow: Debug on Device

You drive the screen yourself in a **look → act → verify** loop, targeting by the
[ladder](../SKILL.md#targeting-ladder).

## 1. Connect a device

Check `yoqa devices active` first: only one session exists, and connecting replaces it. Otherwise list
and connect one — `--platform` is required for phones and simulators. For a web app connect an
installed browser, with `--viewport mobile` for a React Native Web / Expo web build.
[Devices](../references/devices.md)

**Done when** `yoqa devices active` names the device you mean to drive.

## 2. Put the app on screen

How much to set up depends on why you are debugging:

- **Exploring or fixing something** — the app as it is already installed and running (Metro, a manual
  install) is right. Go to step 3.
- **Developing a test case** ([Author test cases](test-cases.md)) — start from a **cold launch**: a
  saved run reinstalls the app, so your walkthrough must begin where a run begins. Reset first:
  [iOS](../references/install-ios.md#clean-install-reset-app-state) ·
  [Android](../references/install-android.md#clean-install-reset-app-state).

To get the app there on a phone or simulator:

1. **Build** — ask the user for the path to the binary; if there is none, build it:
   [iOS native](../references/builds-ios-native.md) ·
   [React Native](../references/builds-react-native.md) · [Android](../references/builds-android.md).
2. **Install** — [iOS](../references/install-ios.md) · [Android](../references/install-android.md).
3. **Launch** — `yoqa action activate-app --app-id <bundle-id>`.

**On web** open the URL instead: `yoqa action open-url --url <web-url>` (the App's Web URL from
`yoqa apps get APP`, or the dev server the user names). For a cold launch,
`yoqa action restart-app --app-id <web-url>` clears the origin's storage and cookies, then loads it.

**Done when** a screenshot shows the app on the screen you mean to start from.

## 3. Look → act → verify

Every action sits between two looks.

1. **Look** — `yoqa screenshot /tmp/screen.png`, then open the image: is the target visible, and is
   anything covering the app? [Inspect & App Control](../references/inspect-and-app-control.md)
2. **Act** — one action, on the highest ladder rung that works.
3. **Verify** — look at the result: add `--screenshot` to the action, or take a fresh screenshot. For
   text that must appear, also `yoqa assert visible -t "<text>"`, which waits for it and exits non-zero
   if it never shows. [Assertions](../references/assertions.md)

```bash
yoqa screenshot /tmp/screen.png                 # open it: the Login button is centred near y 860
yoqa action tap --x 500 --y 860 --screenshot    # open the result: the Welcome screen is showing
yoqa assert visible -t "Welcome back"
```

On web, from connect to a submitted form:

```bash
yoqa devices connect web-chrome --viewport mobile
yoqa action open-url --url http://localhost:8081
yoqa screenshot /tmp/screen.png                 # open it: the Email field is near y 380
yoqa action input --text "ada@example.com" --x 500 --y 380
yoqa action key Tab                             # focus moves to Password
yoqa action input --text "s3cret"               # types into the focused field
yoqa action key Enter --screenshot              # submit, then open the result screenshot
yoqa assert visible -t "Welcome back"
```

When the next several actions are already known and nothing needs a look between them, send them as
one [`action batch`](../references/actions-coordinates.md#batch).

**Done when** what the user asked is answered from a screenshot or assertion taken *after* your last
action — say what it shows.

## 4. Release the device

`yoqa devices disconnect`, so the device is free for the next session. On web this closes the browser
window Yoqa opened.
