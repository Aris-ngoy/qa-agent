# Devices

## List devices

```bash
yoqa devices ios                   # iOS simulators + physical devices
yoqa devices android               # Android emulators + physical devices
yoqa devices web                   # installed Chromium browsers, and the user's Everyday browsers
yoqa devices ios --booted-only     # only booted / online devices
yoqa devices ios --json            # stable shape for parsing
yoqa devices active                # currently connected device
```

Each device prints on two lines — kind, name, OS version, state, then its id on the next line:

```
simulator  iPhone 16 Pro — 18.2 [Booted]
           A1B2C3D4-5678-90AB-CDEF-1234567890AB
```

Unavailable / shut-down devices are **included by default**; pass `--booted-only` to narrow to what's
already running. Use the full id on the second line to connect.

## Connect

`--platform` is required for phones and simulators. Web ids (`web-*`, `chromium-cdp-<port>`) imply
`--platform web`.

```bash
yoqa devices connect <device_id> --platform ios
yoqa devices connect <device_id> --platform android
yoqa devices connect web-chrome
# Connect opens the Direct lane, or it fails.
```

Optionally launch an app as part of connecting:

```bash
yoqa devices connect <device_id> --platform ios --bundle-id com.example.app
yoqa devices connect <device_id> --platform android --app-package com.example.app
```

## Web browsers

A web device is a Chromium browser installed on this Mac. Its id is stable per browser: `web-chrome`,
`web-edge`, `web-brave`, `web-chromium`, `web-dia`. It is listed even when the browser is not running.

```
browser    Google Chrome — 131.0.6778.86 [not running]
           web-chrome
```

Connecting launches a **new browser window that Yoqa owns**, on its own Kept profile: none of the
user's tabs, cookies or logins, but its own logins survive. Disconnecting (or connecting another device)
closes that window and keeps the profile, so the next connect is still signed in. `--booted-only` lists
only browsers Yoqa has open.

To start signed out again, reset the Kept profile while its browser is closed (disconnect first):

```bash
yoqa devices web reset-profile                         # every browser's default profile
yoqa devices web reset-profile --browser web-chrome    # only Chrome's
```

`--app <prefix>` resets an App's profile instead of the default one.

**Viewport preset.** A web connect picks one of two fixed page sizes, kept for the whole session and
stored on any Run that uses it:

| Preset | Page size | Input |
|---|---|---|
| `desktop` (default) | 1280×800 | mouse; swipe is a wheel scroll |
| `mobile` | 390×844 at 3× | touch, with an iPhone user agent; swipe is a finger stroke |

Use `mobile` for a React Native Web / Expo web build, so it lays out and behaves as on a phone. Sizes
other than these two are not accepted.

```bash
yoqa devices connect web-chrome                     # desktop preset
yoqa devices connect web-chrome --viewport mobile   # phone-sized page with touch
yoqa devices active                                 # names the browser and its preset
```

The new window opens on a blank page. Open the app with
`yoqa action open-url --url <Web URL>` (see [Inspect & App Control](inspect-and-app-control.md)).

**The user's Everyday browser.** Only when the user asks to test in their own, signed-in browser.
`web-chrome-everyday`, `web-edge-everyday`, `web-brave-everyday`, `web-chromium-everyday` and
`web-dia-everyday` are the user's running browser on its default profile. Yoqa drives a page in a
window of its own, never the user's tabs, and nothing there is wiped: you act in the user's real
accounts.

```
browser    Google Chrome (everyday) — everyday browser [remote debugging off]
           web-chrome-everyday
           Turn it on at chrome://inspect/#remote-debugging, then connect
```

It is `[ready]` once the user has turned remote debugging on. When it is off, **ask the user** to open
`chrome://inspect/#remote-debugging` in that browser and turn the toggle on, then list again. Each
connect then waits up to 60 s on an Allow prompt in the browser: before you connect, **tell the user to
click Allow** when it appears. A Deny or no answer fails the connect with its own message; ask before
trying again, since each try prompts again.

The first connect for an App fails with a warning about acting in the user's real session. Show the
user that warning and connect with `--yes` only once they agree; it is remembered for that App.

```bash
yoqa devices connect web-chrome-everyday --app <prefix>          # first use: prints the warning
yoqa devices connect web-chrome-everyday --app <prefix> --yes    # the user agreed; they click Allow
```

On success it prints the browser profile the window opened in (`profile Work`). A Run uses the Everyday
browser only when named with `--device web-chrome-everyday`, and `--profile clean` fails there.

**Never relaunch the user's browser with `--remote-debugging-port`** or any other debug flag, and never
quit it, to get past the toggle or the Allow prompt. That skips the user's consent. If the toggle is off
or the user denies, stop and ask.

**Attach to a browser the user started (CI).** For CI and scripts, or only when the user asks for it (a
prepared profile, an Electron-like setup). The user starts Chrome, Edge or Brave with a debug port **and a non-default
profile** — Chrome 136 and later refuse remote debugging on the everyday profile:

```bash
# The user runs this, not you:
# "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/yoqa-chrome
yoqa devices connect chromium-cdp-9222
yoqa devices connect chromium-cdp-9222 --viewport mobile
```

Ports are never scanned: the id names the port. If nothing answers there, the connect fails and says
how to start the browser. Disconnecting an attached browser leaves it open.

## Physical iPhone signing

Connecting a cabled iPhone first signs and builds YoqaRunner for it with one Apple team. The team is
`YOQA_IOS_TEAM_ID` if set, else the team saved with `yoqa signing use` (or in the desktop's
Settings › iOS), else the team of the newest Apple Development certificate in the keychain.

```bash
yoqa signing                       # the team in use, where it came from, and every team on this Mac
yoqa signing use <TeamID>          # sign with this team from now on (desktop and CLI share it)
yoqa signing use auto              # back to the newest certificate in the keychain
yoqa signing check                 # sign for the one cabled iPhone now; exits 1 with the fix
yoqa signing check --device <udid> --json
```

When a connect fails with "Check that team … can sign for this iPhone", run `yoqa signing check`: it
registers the phone with the team and refreshes the profile, or says what to fix (sign in to Xcode,
unlock the phone, Developer Mode). A free Personal Team's profile lasts 7 days and covers 3 devices.

On a free Personal Team, the first connect to an iPhone installs YoqaRunner and then stops: the phone
must trust the developer once, by hand. `yoqa devices connect` exits 1 and prints what to tap
(Settings › General › VPN & Device Management › the "Apple Development: …" entry › Trust). **Ask the user
to do that on the phone**, then run the same connect again; it reuses the build and only launches.

## Disconnect

```bash
yoqa devices disconnect            # close the active Device Session
```

**Only one session exists at a time.** Check `yoqa devices active` before connecting; connecting again
replaces the current session. Disconnect when you're done so another run can take the device.

## Tips

- Prefer a booted simulator over a physical device for speed
- `--bundle-id` / `--app-package` do not apply on web; open the page with `open-url` after connecting
- If `yoqa devices connect` fails, run `yoqa doctor --fix` — see [Environment](environment.md)
