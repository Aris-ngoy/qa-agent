# Runner app icons

## Goal

The apps Yoqa installs on a device showed the platform's blank icon. `YoqaRunnerUITests-Runner` (the app a cabled iPhone actually runs), its `YoqaRunner` host app, and the `yoqa.android.devtools` helper (Android) should carry the Yoqa logo, so a user who sees them on their phone or in Settings knows what they are.

## Plan summary

- One source: `apps/desktop/assets/icon.svg`, the same mark as the desktop app. `bun run icons` in `apps/desktop` already rendered it; it now also writes the runner assets, so the logo cannot drift between surfaces.
- iOS uses a single 1024 universal AppIcon; Xcode scales it. Android uses legacy `mipmap-*` PNGs at the five density buckets. An adaptive icon was not added: the helper has no launcher entry, so the icon only shows in Settings and the package installer, and `minSdk` 24 would still need the PNGs.
- `YoqaRunnerUITests-Runner` is the app on the phone's home screen, and no build setting reaches it: Xcode copies it from its `XCTRunner.app` template (binary and Info.plist) after the UI-test target's build phases, so a Run Script phase is overwritten too. `prepareYoqaRunner` therefore brands it after `build-for-testing`: it copies the host app's compiled `AppIcon*.png` and `Assets.car` in, inserts the host's `CFBundleIcons`, and re-signs with the leaf certificate Xcode signed it with (`--preserve-metadata=identifier,entitlements,flags,runtime`). Rejected: a scheme post-action, which runs after signing too, fails silently, and cannot be tested.
- Branding is cosmetic, so it works on a copy that replaces the runner only once signed. Any failure logs `[yoqa-runner] the runner keeps Xcode's blank icon: …` and the connect continues with the unbranded runner.

## What shipped

- `apps/desktop/scripts/generate-app-icon.ts` writes `native/yoqa-runner/YoqaRunner/Assets.xcassets/{AppIcon,Logo}` and `native/android-devtools/app/src/main/res/mipmap-*/ic_launcher.png`.
- `YoqaRunner`: `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`; the host screen shows the logo above "Yoqa Runner".
- `services/runner/src/domains/devices/yoqa-runner.ts`: `brandRunnerApp` runs after every build. `build.json` gains `version: 2`; a cached build without it rebuilds once, so phones that already have an unbranded runner get the icon on the next connect.
- Android devtools: `android:icon="@mipmap/ic_launcher"`; `versionCode` and `DEVTOOLS_VERSION_CODE` go to 2, so devices with version 1 reinstall the helper and get the icon. A local `app-debug.apk` still at version 1 is reinstalled on every session start until `./gradlew assembleDebug` rebuilds it; with no APK built, a device on version 1 now fails to start the helper with "APK is not built".

## How to verify

- `cd apps/desktop && bun run icons`, then `git status`: no changes means the committed assets match the SVG.
- `yoqa-runner.test.ts`: the runner gets the icon and is re-signed with its own certificate; a failed re-sign leaves it as Xcode signed it; an unversioned cached build rebuilds once.
- On a cabled iPhone, connect once: no `keeps Xcode's blank icon` warning, and `YoqaRunnerUITests-Runner` shows the logo on the home screen. In `~/.yoqa/yoqa-runner/<key>/DerivedData/Build/Products/Debug-iphoneos/YoqaRunnerUITests-Runner.app`, `codesign --verify --strict` passes and `plutil -extract CFBundleIcons json -o - Info.plist` names `AppIcon`. Verified on an iPhone 15: the branded runner installed and listened.
- `cd native/android-devtools && ./gradlew assembleDebug`, then `aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk`: `versionCode='2'` and `application-icon-*` at five densities.

## Follow-ups

None.
