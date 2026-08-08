# Builds

The **build registry** holds the app binaries YoQA runs tests against. Register a build once, then reference it by **ID** across many runs — no need to re-pass a file path each time.

This file covers managing builds *in YoQA*. To produce a binary in the first place, see [iOS Native Builds](builds-ios-native.md) · [React Native Builds](builds-react-native.md) · [Android Builds](builds-android.md).

```bash
yoqa builds list APP                                  # list builds (ID, NAME, VERSION, PLATFORM, SOURCE)
yoqa builds list APP --json                           # raw JSON output
yoqa builds create APP /abs/path/App.ipa              # register a build from a local file
yoqa builds create APP /abs/path/App.ipa --name "RC1" # register with a human-readable name
yoqa builds delete APP <build-id>                     # delete a build (irreversible)
```

- **`create`** takes an **absolute path** to a `.ipa` (iOS device), `.app` (iOS simulator), or `.apk` (Android). Version, bundle ID, and platform are parsed from the file automatically — you don't pass them.
- `--name` is optional; it's only a label to recognise the build later.
- **Storage depends on the account:** on a `team` account the build is uploaded to the cloud and shared across the workspace; otherwise it's stored locally on this machine. `yoqa builds list` shows both (the `SOURCE` column is `cloud` or `local`).
- The `ID` from `builds list` / `builds create` is what you pass to `yoqa runs create APP <cases> --build-id <id>`. See [Run Tests](run.md).

> **`builds delete` is destructive and irreversible — always get explicit user approval first.** Name the exact build (id + name/version) you intend to delete and wait for confirmation before running. Never delete a build the user didn't ask you to remove.
