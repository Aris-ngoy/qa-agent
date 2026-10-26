# Windows app icon

## Goal

Show the Yoqa icon, not Bun's, for the Windows desktop app in Explorer, the taskbar and the window.

## Plan summary

- electrobun 1.18 embeds `build.win.icon` into `launcher.exe`, `bun.exe` and the installer with `rcedit`. Its compiled CLI calls `require.resolve("rcedit/package.json")`, which resolves against the path the CLI was built on (`D:\a\electrobun\…`). Every embed fails with a warning, and the exes keep Bun's icon.
- `build.win.icon` was the 1024 px PNG. electrobun copies it unchanged to `Resources/app.ico`, so that file was a renamed PNG and not a valid ICO.
- Fix: commit a real multi-size `assets/icon.ico`, and run `rcedit` from a `postBuild` hook that resolves it from electrobun's own dependencies.
- Rejected: adding `png-to-ico` or `rcedit` as direct dependencies. The ICO packer is a few lines with no dependency, and `rcedit` always comes with electrobun.

## What shipped

- `src/bun/features/windows-icon.ts`: `pngsToIco()` packs PNG frames into an `.ico` (PNG-compressed entries), with tests.
- `scripts/generate-windows-icon.ts`: renders `assets/icon.svg` with resvg at 16–256 px into `assets/icon.ico`. It runs on any OS, and `generate-app-icon.ts` calls it too.
- `scripts/embed-windows-icon.ts` (`scripts.postBuild`): on Windows builds it embeds `assets/icon.ico` into `<build>/<app>/bin/launcher.exe` and `bun.exe`. It runs before the bundle is packed, so installed apps get the icon as well.
- `electrobun.config.ts`: `win.icon` is now `assets/icon.ico`.

## How to verify

- `bun test ./apps/desktop/src/bun/features/windows-icon.test.ts`
- On Windows, run `bun run build` in `apps/desktop`. The log shows `[yoqa desktop] icon embedded into …\launcher.exe` and `…\bun.exe`, and both exes show the Yoqa icon in Explorer.
- Restart `bun dev`. The running app shows the Yoqa icon in the taskbar. Windows caches icons, so an old pin can keep showing Bun's icon until you unpin and re-pin it.

## Follow-ups

- The installer `yoqa-Setup.exe` still gets Bun's icon. electrobun sets its icon (which fails the same way) and zips it before any hook runs. Fixing it needs electrobun to resolve `rcedit` correctly, or a `postPackage` step that patches the exe and rebuilds the zip.
- Report the `rcedit` resolution bug upstream to electrobun, then drop the hook once a fixed release lands.
