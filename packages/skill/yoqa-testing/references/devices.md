# Devices

## List devices

```bash
yoqa devices ios                   # iOS simulators + physical devices
yoqa devices android               # Android emulators + physical devices
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

`--platform` is required.

```bash
yoqa devices connect <device_id> --platform ios
yoqa devices connect <device_id> --platform android
# Connect opens the Direct lane, or it fails.
```

Optionally launch an app as part of connecting:

```bash
yoqa devices connect <device_id> --platform ios --bundle-id com.example.app
yoqa devices connect <device_id> --platform android --app-package com.example.app
```

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
- If `yoqa devices connect` fails, run `yoqa doctor --fix` — see [Environment](environment.md)
