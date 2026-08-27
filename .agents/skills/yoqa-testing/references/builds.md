# Builds

The **build registry** holds the app binaries Yoqa runs tests against. Register a build once, then
reference it by **ID** across many runs — no need to re-pass a file path each time.

This file covers managing builds *in Yoqa*. To produce a binary in the first place, see
[iOS Native Builds](builds-ios-native.md) · [React Native Builds](builds-react-native.md) ·
[Android Builds](builds-android.md).

Note the argument order: the **path is positional and comes first**; the app is a flag.

```bash
yoqa builds create /abs/path/App.ipa --app APP
yoqa builds create /abs/path/App.ipa --app APP --name "RC1"
yoqa builds list                                  # all registered builds
yoqa builds list APP                              # builds for one app
yoqa builds list APP --json
yoqa builds delete <build-id>                     # no app argument
```

- **`create`** takes an **absolute path** to a `.ipa` (iOS device), `.app` (iOS simulator), or `.apk`
  (Android). Version, bundle ID, and platform are parsed from the file automatically — you don't pass them.
- `--app` is optional but recommended; it associates the build with an app so `builds list APP` finds it.
- `--name` is optional; it's only a label to recognise the build later.
- `builds list` prints `<id>  <platform>  <name>  <path>`; use `--json` for the full record.
- The `id` is what you pass to `yoqa runs create APP --cases <n> --build-id <id>`. See [Run Tests](run.md).

> **`builds delete` is destructive and irreversible — always get explicit user approval first.** Name the
> exact build (id + name) you intend to delete and wait for confirmation before running. Never delete a
> build the user didn't ask you to remove.
