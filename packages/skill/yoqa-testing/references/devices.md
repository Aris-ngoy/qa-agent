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
```

Optionally launch an app as part of connecting:

```bash
yoqa devices connect <device_id> --platform ios --bundle-id com.example.app
yoqa devices connect <device_id> --platform android --app-package com.example.app
```

## Disconnect

```bash
yoqa devices disconnect            # close the active Appium session
```

**Only one session exists at a time.** Check `yoqa devices active` before connecting; connecting again
replaces the current session. Disconnect when you're done so another run can take the device.

## Tips

- Prefer a booted simulator over a physical device for speed
- If `yoqa devices connect` fails, run `yoqa doctor --fix` — see [Environment](environment.md)
- An iOS physical device needs WebDriverAgent installed first: `yoqa setup ios --device <udid> --kind physical`
