# Android toolchain paths in Settings

## Goal

Let users see the Android SDK and JDK paths Yoqa detected, and override them when the system defaults are wrong — without exporting shell env vars for GUI launches.

## Plan summary

- Add an **Android** Settings tab next to iOS.
- Default to `ANDROID_HOME` / `ANDROID_SDK_ROOT` / Android Studio SDK, and `JAVA_HOME` / Android Studio JBR / `java_home`.
- Store only true overrides in `~/Library/Application Support/yoqa/settings.json`. Paths that match the live system default are stored as `null`.
- Inject the effective paths into the runner sidecar env (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `JAVA_HOME`) and restart the runner on save so Appium sees them.
- Rejected: per-session Appium capabilities for SDK root (env is what UiAutomator2 actually reads).

## What shipped

- Settings → **Android**: SDK root and `JAVA_HOME` fields, system-default helper text, reset, save + runner restart
- Desktop RPC `getAndroidToolchain` / `setAndroidToolchainSelection`
- Shared `settings.json` store used by iOS and Android prefs
- Runner sidecar spawn applies effective Android/Java env
- Runner still fills missing `ANDROID_HOME` / `JAVA_HOME` from the platform default when launched from the CLI
- Desktop replaces a leftover local runner from a previous launch (same version, not our child) so Appium is not started with a GUI-stripped env
- Managed Appium is spawned with an explicit SDK/JDK env and is stopped when the runner exits

## How to verify

1. Open Settings → Android. SDK should show `~/Library/Android/sdk` (or your `ANDROID_HOME`) and Java should show `JAVA_HOME` or Android Studio JBR.
2. Change SDK to another existing SDK folder, click **Save and restart runner**, start an Android session — Appium should use the override.
3. Click **Use system default**, save again — session should work with the detected path.
4. `~/Library/Application Support/yoqa/settings.json` should contain `"android"` only when an override is set.
5. Quit Yoqa, reopen, run on a physical Android device — session must not fail with `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported`.

## Follow-ups

- Folder picker for SDK / JDK paths
- Surface the same overrides in Diagnostics / doctor output
