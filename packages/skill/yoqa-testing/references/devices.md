# Devices

## List devices

```bash
yoqa devices ios                   # iOS simulators + physical devices
yoqa devices android               # Android emulators + physical devices
yoqa devices active                # currently connected device
```

Output columns: TYPE, OS, STATUS, MODEL, ID. Use the full ID to connect.

Physical devices are listed first. Simulators/emulators are capped at 10; use `--all` to see all.

## Connect

```bash
yoqa devices connect <device_id>   # open an Appium session on this device
```

**Always check `yoqa devices active` before connecting** — only one session at a time.

## Tips

- Prefer a booted simulator over a physical device for speed
- If `yoqa devices connect` fails, check that the device is available (`STATUS: available` or `shutdown`)
- iOS physical device requires the Yoqa app to be trusted on the device
