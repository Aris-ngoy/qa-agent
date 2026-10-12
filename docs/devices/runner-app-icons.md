# Runner app icons

## Goal

The apps Yoqa installs on a device showed the platform's blank icon. The `YoqaRunner` host app (cabled iPhone) and the `yoqa.android.devtools` helper (Android) should carry the Yoqa logo, so a user who sees them on their phone or in Settings knows what they are.

## Plan summary

- One source: `apps/desktop/assets/icon.svg`, the same mark as the desktop app. `bun run icons` in `apps/desktop` already rendered it; it now also writes the runner assets, so the logo cannot drift between surfaces.
- iOS uses a single 1024 universal AppIcon; Xcode scales it. Android uses legacy `mipmap-*` PNGs at the five density buckets. An adaptive icon was not added: the helper has no launcher entry, so the icon only shows in Settings and the package installer, and `minSdk` 24 would still need the PNGs.
- The XCUITest `YoqaRunnerUITests-Runner` app keeps Xcode's blank icon. Xcode generates it from its own template, and the project has no hook to set its icon.

## What shipped

- `apps/desktop/scripts/generate-app-icon.ts` writes `native/yoqa-runner/YoqaRunner/Assets.xcassets/{AppIcon,Logo}` and `native/android-devtools/app/src/main/res/mipmap-*/ic_launcher.png`.
- `YoqaRunner`: `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`; the host screen shows the logo above "Yoqa Runner". The asset catalog is in the hashed sources, so cached runner builds rebuild once.
- Android devtools: `android:icon="@mipmap/ic_launcher"`; `versionCode` and `DEVTOOLS_VERSION_CODE` go to 2, so devices with version 1 reinstall the helper and get the icon. A local `app-debug.apk` still at version 1 is reinstalled on every session start until `./gradlew assembleDebug` rebuilds it; with no APK built, a device on version 1 now fails to start the helper with "APK is not built".

## How to verify

- `cd apps/desktop && bun run icons`, then `git status`: no changes means the committed assets match the SVG.
- `xcodebuild build -project native/yoqa-runner/YoqaRunner.xcodeproj -scheme YoqaRunner -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`: the `.app` holds `AppIcon60x60@2x.png` and `Info.plist` names `AppIcon`.
- `cd native/android-devtools && ./gradlew assembleDebug`, then `aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk`: `versionCode='2'` and `application-icon-*` at five densities.

## Follow-ups

- Brand `YoqaRunnerUITests-Runner`, the app the phone actually runs during a session. It would mean patching the built runner bundle after `build-for-testing` and re-signing it.
