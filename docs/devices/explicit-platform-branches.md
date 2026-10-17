# Explicit platform branches and one App start-target resolver

## Goal

Get ready for a third platform (`web`, [#301](https://github.com/Aris-ngoy/qa-agent/issues/301)) without changing any behaviour. Before this change, about 20 places in the runner, the CLI and the desktop chose a platform with "iOS, otherwise Android", so a `web` device would have gone down the Android path without any error. Ticket [#302](https://github.com/Aris-ngoy/qa-agent/issues/302). Vocabulary: **App**, **Run**, **Active Session** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Every branch handles every platform.** Branches that return a value are `switch` statements on `DevicePlatform` with no `default`. Under `noImplicitReturns`, a platform with no `case` fails the typecheck. Per-platform tables are typed `Record<DevicePlatform, …>`. The one switch that returns `void` (`installBuildOnDevice`) has a `default` that throws on `platform satisfies never`.
- **Input checks use the schema.** Places that validate untrusted input (CLI `--platform`, the desktop's remembered device and its platform picker) parse it with `devicePlatformSchema` instead of comparing it to `"ios"` and `"android"`.
- **One start-target resolver.** `appStartTarget(app, platform)` in `@yoqa/runner-client` returns the App's start target: the bundle id on iOS, the application id on Android. `startTargetRequest(platform, target)` puts that target in the connect or retarget request field its platform reads (`bundleId` or `appPackage`). A Run, the desktop's session target app and the Inspector's snippet app id all use the resolver.
- **Kept as they are:** the lane guards (`createAndroidDirectSession` rejects a non-Android platform, and so on), which already reject every other platform, and `BenchmarkPlatform`, a separate type that stays narrow.
- Rejected: an `assertNever` helper. `noImplicitReturns` already enforces the switches that return a value, so only the one `void` switch needs an explicit `never`.

## What shipped

- `packages/runner-client/src/app-start-target.ts`: `appStartTarget` and `startTargetRequest`, exported from the package.
- Runs (`runs/application.ts`): the session acquire and the agent's `defaultAppId` both use the resolved start target. A Run now sends only its own platform's id. Each Lane only ever read its own id, so this changes nothing on the device. The id is also trimmed now, as the desktop already did.
- Runner: `listDevices`, `installBuildOnDevice` (now split into `installIosBuild` and `installAndroidBuild`), `deviceClassFor`, `defaultLanesFor`, `targetAppFor` and `screenshotPointerSize` are exhaustive over the platform.
- CLI: `parsePlatform` and `PLATFORM_DEVICES_DESCRIPTION` (`packages/cli/src/platform.ts`) replace the three hand-written `--platform` checks and the `yoqa devices <platform>` description ternary. The error text and the descriptions are unchanged.
- Desktop: `DevicePlatform` is the client package's type and no longer a local copy. `appTargetFor`, `platformLabel`, `PlatformGlyph`, the session toolbar's platform labels and the Inspector's snippet app id are exhaustive.

## How to verify

```bash
bun test packages/runner-client/src/app-start-target.test.ts packages/cli/src/platform.test.ts \
  apps/desktop/src/mainview/features/devices/session-app.test.ts
bun run lint:ci && bun run test && bun run check
```

To see the enforcement, add `z.literal("web")` to `devicePlatformSchema` and run `bunx tsc --noEmit` in each package. Every branch listed above fails until `web` has a case.

## Follow-ups

- [#301](https://github.com/Aris-ngoy/qa-agent/issues/301)'s web tickets add the `web` cases, including the App's Web URL in `appStartTarget`.
- `android-gestures.ts` and `android-alerts.ts` still contain WebDriver helpers left over from Appium (`isAndroidDriver`, `injectTap`, `alertAttemptsFor`). Only their own tests call them. They read a WebDriver `platformName` string, not `DevicePlatform`, and could be deleted.
