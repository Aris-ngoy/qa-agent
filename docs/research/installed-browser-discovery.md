# Research: finding and launching installed browsers on macOS and Windows

Ticket [#343](https://github.com/Aris-ngoy/qa-agent/issues/343), under map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339). Background: [web-installed-browsers.md](../devices/web-installed-browsers.md). Code: `services/runner/src/domains/devices/chromium-browsers.ts`. Today it reads only `/Applications` and `~/Applications` on macOS, for Chrome, Edge, Brave and Chromium.

**Status markers:** **[confirmed]** means read from a primary source (vendor docs or source code) or observed on this Mac on 2026-10-28. **[unverified]** means from memory or secondary sources only, and needs checking on a real machine before code relies on it.

## Answer in short

- **macOS:** keep the bundle approach and add bundles. Every browser is a `.app` with `Contents/MacOS/<CFBundleExecutable>` and a version in `Contents/Info.plist`. Read `CFBundleExecutable` rather than assume it equals the bundle name. For Dia and Arc, `CFBundleShortVersionString` is the app's own version, not the Chromium version.
- **Windows:** there is no single source of truth.
  1. Probe the fixed vendor folders under `%LOCALAPPDATA%`, `%ProgramFiles%` and `%ProgramFiles(x86)%`, per-user first. Playwright does exactly this for Chrome and Edge.
  2. Then read `App Paths\<exe>` (HKCU, then HKLM).
  3. Then read `Clients\StartMenuInternet\*\shell\open\command` (HKCU, then HKLM).
  Read the version from the `<version>\` folder next to the exe.
- **Launch:** `--user-data-dir=<temp>` together with `--remote-debugging-port=0` works for every Chromium browser checked. Since Chrome 136 it is the only way: the debug switches are ignored on the default profile. **Dia honours both [confirmed on this Mac]**, but with a twist: its `DevToolsActivePort` lands in `<dir>/User Data/`, not in `<dir>/`. A fresh Dia profile also opens a mandatory Atlassian sign-up page with reCAPTCHA. Arc is very likely the same (shared ArcCore code) [unverified].
- **Firefox** is not a CDP browser any more. CDP was removed in Firefox 141, and `--remote-debugging-port` now serves WebDriver BiDi only. It needs `--profile <dir>`, not `--user-data-dir`, and it writes `WebDriverBiDiServer.json`, not `DevToolsActivePort`. It needs its own lane, not `launchChromium`.
- **MSIX-packaged browsers on Windows** (Arc, and reportedly Dia) are installed per user under `C:\Program Files\WindowsApps\…`. They have no Program Files or registry footprint to probe. If virtualized, their new files under `AppData\Local` are redirected to a private per-package location, which could hide a `DevToolsActivePort` written under `%TEMP%`. Prefer a profile dir outside `AppData`, or read the `DevTools listening on ws://…` stderr line.

## macOS

| Browser | Bundle (in `/Applications` or `~/Applications`) | `CFBundleExecutable` | Bundle id | Default profile dir (`~/Library/Application Support/…`) | Status |
|---|---|---|---|---|---|
| Chrome | `Google Chrome.app` | `Google Chrome` | `com.google.Chrome` | `Google/Chrome` | confirmed (local plist; Chromium docs) |
| Chrome Beta / Dev / Canary | `Google Chrome Beta.app` etc. | same as bundle name | — | `Google/Chrome Beta` etc. | confirmed (Playwright paths; Chromium docs) |
| Edge | `Microsoft Edge.app` (+ ` Beta`/` Dev`/` Canary`) | `Microsoft Edge` | `com.microsoft.edgemac` [unverified] | — | path confirmed (Playwright) |
| Brave | `Brave Browser.app` | `Brave Browser` | `com.brave.Browser` [unverified] | — | path in current code; unverified here |
| Chromium | `Chromium.app` | `Chromium` | `org.chromium.Chromium` [unverified] | `Chromium` | profile dir confirmed (Chromium docs) |
| Dia | `Dia.app` | `Dia` | `company.thebrowser.dia` | `Dia/` (the Chromium profile is `Dia/User Data/`) | confirmed (local) |
| Arc | `Arc.app` | `Arc` [unverified] | `company.thebrowser.Browser` [unverified] | `Arc/User Data/` [unverified] | not installed here |
| Opera | `Opera.app` (GX: `Opera GX.app`) | `Opera` [unverified] | `com.operasoftware.Opera` [unverified] | `com.operasoftware.Opera` [unverified] | unverified |
| Vivaldi | `Vivaldi.app` | `Vivaldi` [unverified] | `com.vivaldi.Vivaldi` [unverified] | — | unverified |
| Firefox | `Firefox.app` | `firefox` (lower case) | `org.mozilla.firefox` [unverified] | — | exe confirmed (Puppeteer, Playwright) |
| Safari | `Safari.app` | `Safari` | `com.apple.Safari` | — | confirmed (local); no CDP, WebDriver via `safaridriver` only — out of scope |

**Version.** `Contents/Info.plist` → `CFBundleShortVersionString`. On this Mac, Chrome reports `156.0.8078.73`, Dia `1.54.2` and Safari `27.0.1` [confirmed].
- Dia's Chromium version lives in `Dia.app/Contents/Frameworks/ArcCore.framework/Versions/A/Resources/Info.plist` (`156.0.8078.48`). CDP `/json/version` also reports it (`Chrome/156.0.8078.48`) [confirmed].
- Chrome keeps old framework versions side by side (`Google Chrome Framework.framework/Versions/156.0.8078.48` and `…73`), so do not derive the version from that folder [confirmed].
- The regex in `bundleVersion` works for these plists, but `plutil -convert json` would also handle binary plists [confirmed: `plutil` works on all three].

**Discovery beyond the two folders.** Browsers can live elsewhere, for example on another volume or under `~/Applications/Chrome Apps`. LaunchServices knows every registered bundle by id: `NSWorkspace.urlsForApplications(withBundleIdentifier:)`, or `mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'"`. Spotlight was rejected earlier because it misses unindexed volumes. A bundle-id lookup as a *fallback* after the fixed folders keeps the fast path and finds the stragglers [unverified, not tried].

## Windows

**Install folders.** The relative path is joined to each base in order: `%LOCALAPPDATA%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`. This is Playwright's order, per-user first [confirmed: Playwright `registry/index.ts`]. Chrome's installer puts system installs under `DIR_PROGRAM_FILES` and per-user installs under `DIR_LOCAL_APP_DATA`, each `…\<Company>\<Product>\Application\` [confirmed: Chromium `chrome/installer/util/helper.cc`].

| Browser | Relative path | Exe | Per-user / system | Updater `Clients` key (value `pv`) | Status |
|---|---|---|---|---|---|
| Chrome | `Google\Chrome\Application\chrome.exe` (Beta `Chrome Beta`, Dev `Chrome Dev`, Canary `Chrome SxS`) | `chrome.exe` | both (`supports_system_level = true`) | `Software\Google\Update\Clients\{8A69D345-D564-463c-AFF1-A69D9E530F96}` in HKCU (user) or HKLM, read with `KEY_WOW64_32KEY`, so `WOW6432Node` | confirmed (Chromium `google_chrome_install_modes.h`, `install_modes.cc`, `installation_state.cc`) |
| Edge | `Microsoft\Edge\Application\msedge.exe` (`Edge Beta`, `Edge Dev`, `Edge SxS`) | `msedge.exe` | both: policy can force machine-wide or per-user | app ids: Stable `{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}`, Beta `{2CD8A007-…}`, Dev `{0D50BFEC-…}`, Canary `{65C35B14-…}`. Key root `Software\Microsoft\EdgeUpdate\Clients\…` [unverified] | path confirmed (Playwright); ids confirmed (Edge Update policy docs) |
| Brave | `BraveSoftware\Brave-Browser\Application\brave.exe` (`-Beta`, `-Dev`, `-Nightly` suffixes) | `brave.exe` | both | `Software\BraveSoftware\Update\Clients\{AFE6A462-C574-4B8A-AF43-4CC60DF4563B}` | confirmed (brave-core `chromium_install_modes.h`, `install_modes.cc`, `util_constants.h`) |
| Chromium | `Chromium\Application\chrome.exe` | `chrome.exe` | both, but there is no official installer. Snapshot zips run from wherever they were unzipped | none (no Google Update) | confirmed (Chromium `chromium_install_modes.h`) |
| Vivaldi | `Vivaldi\Application\vivaldi.exe` [unverified] | `vivaldi.exe` [unverified] | per-user default; all-users; **standalone** (one folder, no registry) | — | install modes confirmed (Vivaldi help); path unverified |
| Opera | `Programs\Opera\` under `%LOCALAPPDATA%`, with `launcher.exe` and `opera.exe` [unverified] | `launcher.exe` / `opera.exe` | per-user by default [unverified, forum only] | — | unverified |
| Arc | MSIX package `TheBrowserCompany.Arc`, x64, from `releases.arc.net/windows/prod/Arc.appinstaller` | `Arc.exe` [unverified] | per-user (MSIX) | none; use `Get-AppxPackage` | package confirmed (appinstaller XML) |
| Dia | "Available for macOS and Windows" (diabrowser.com). Packaging reported as MSIX on Windows 11 only | — | per-user (if MSIX) | — | availability confirmed; packaging unverified (secondary) |
| Firefox | `Mozilla Firefox\firefox.exe` | `firefox.exe` | system; per-user possible [unverified] | `StartMenuInternet\Firefox-<pathhash>` | path confirmed (Playwright); key confirmed (Firefox NSIS `shared.nsh`) |

**Registry, in the order worth reading.**
1. **App Paths:** `HKCU`, then `HKLM`, `\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`.
   - `(Default)` is the full exe path, and `Path` is its folder. Per-user installs register under HKCU, and Microsoft recommends per-user installs since Windows 7. It is meant for `ShellExecuteEx`, not `CreateProcess`, but reading it as data is fine [confirmed: Microsoft "Application Registration"].
   - Chrome writes `App Paths\chrome.exe` [confirmed: Chromium `shell_util.cc`].
   - **Caveat:** Chrome, Chromium and any other Chromium build that installs a `chrome.exe` share that one key name, so whichever registered last wins.
2. **StartMenuInternet:** `HKCU`, then `HKLM`, `\SOFTWARE\Clients\StartMenuInternet\<name>\shell\open\command`. `(Default)` is a quoted command line.
   - Microsoft says the subkey should be the exe name. Chrome uses the app name instead (`Google Chrome`, plus a `.<suffix>` for per-user installs), because "that ship has sailed" [confirmed: `shell_util.cc` comment]. Firefox uses `Firefox-<pathhash>` [confirmed].
   - So enumerate all subkeys and parse the command. Do not look up a fixed name.
   - Its Start-menu role is dead since Windows 7, but browsers still register `Capabilities` there for Default Apps (`RegisteredApplications` points into it) [confirmed: Microsoft docs; `shell_util.cc`].
   - This is the one place that lists every browser, Vivaldi and Opera included, when they registered at all. Vivaldi standalone does not.
3. **MSIX apps** (Arc, maybe Dia) appear in neither. Find them with `Get-AppxPackage -Name TheBrowserCompany.Arc` (`InstallLocation`) [unverified for Arc's manifest]. Their exe sits inside read-only `WindowsApps`. Launching it directly needs either an app execution alias the manifest may or may not declare, or package activation. Neither is checked.

**Version on Windows.**
- Chromium-family installers lay out `Application\<version>\` beside the exe [confirmed: `setup_util.cc`, `installer_state.cc` use `target_path().AppendASCII(version.GetString())`]. Listing that folder for a dotted-version name needs no registry access and no PowerShell.
- The updater `pv` value (table above) is the alternative for Chrome and Brave.
- The exe's VERSIONINFO also works, but reading it needs PowerShell or a PE parser.
- Firefox: `application.ini` in the install folder, `[App] Version=` [confirmed: `build/application.ini.in`].

## Launching

**Chromium family.**
- Chrome 136 and later ignore `--remote-debugging-port` and `--remote-debugging-pipe` on the default user data dir [confirmed: Chrome blog, 2025-03-17]. Yoqa's throwaway `mkdtemp` profile already satisfies this. Never point a launch at a real profile.
- `--user-data-dir` is the standard override [confirmed: Chromium `docs/user_data_dir.md`].
- Two instances cannot share one user data dir. Distinct dirs give distinct processes, even while the user's own copy runs. Dia confirmed this on this Mac.
- Flags: the runner's current set matches Playwright's for first-run suppression: `--no-first-run`, `--no-default-browser-check`, `--disable-search-engine-choice-screen`, `--disable-sync`, `--use-mock-keychain`, `--password-store=basic` [confirmed: Playwright `chromiumSwitches.ts`]. For Edge, Playwright also adds:
  - `--disable-features=msForceBrowserSignIn` (forced Edge sign-in)
  - `--disable-edgeupdater` and `--disable-updater-scheduler` (Edge updater on mac)
  - `--edge-skip-compat-layer-relaunch` (on Windows, Edge can relaunch itself and lose the CDP port)
  - `--do-not-de-elevate` (an elevated parent relaunches Chrome as non-admin)
  Worth adopting for Edge and Windows.
- **Ready signal:** `DevToolsActivePort` in the user data dir. The browser also prints `DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>` to stderr [confirmed: Dia's stderr on this Mac]. The stderr line is a fallback that does not depend on where the file landed.

**Dia, probed on this Mac** (Dia 1.54.2, ArcCore and Chromium 156.0.8078.48). Command: `Dia --user-data-dir=<mktemp -d> --remote-debugging-port=0 --no-first-run --no-default-browser-check about:blank`, launched while the user's own Dia was running.
- **A second instance started** alongside the user's. **[confirmed]**
- **Dia treats `--user-data-dir` as its app-support root.** It created `<dir>/RemoteAssetDirectory` and `<dir>/User Data`, then passed Chromium `--user-data-dir=<dir>/User Data`. Its Swift layer has a `CommandLineSwitches` type that reads `--user-data-dir`. **[confirmed]**
- **`DevToolsActivePort` appeared at `<dir>/User Data/DevToolsActivePort`** (port `52034`, path `/devtools/browser/<uuid>`), not at `<dir>/DevToolsActivePort`. Today's `readActivePort(profileDir)` would time out on Dia. **[confirmed]**
- CDP answered `/json/version` with `Browser: Chrome/156.0.8078.48`. **[confirmed]**
- **First run is a sign-in wall:** the only page target was `https://id.atlassian.com/signup?application=dia--mac`, with a reCAPTCHA iframe. No `about:blank` tab opened, and `--no-first-run` does not skip it. **[confirmed]**
- Safety check:
  - The probe's open files under `~/Library` were only the shared `Caches/company.thebrowser.dia` and `HTTPStorages/company.thebrowser.dia` (NSURLSession stores keyed by bundle id). `~/Library/Application Support/Dia` was untouched (mtime listing identical before and after).
  - The instance was SIGKILLed and the temp dir deleted. **[confirmed]**
- Dia's main binary contains Arc's string "You must run Arc with --remote-debugging-port=<number>", next to a "Copy DevTools WebSocket URL" feature. That suggests Arc on macOS honours the same switches and the same `<dir>/User Data` layout [unverified; Arc not installed].

**Firefox.**
- CDP is gone as of Firefox 141 [confirmed: Mozilla fxdx.dev post]. `--remote-debugging-port [<port>]` starts the Remote Agent "used for WebDriver BiDi", default port 9222, and `0` picks a free port [confirmed: `RemoteAgent.sys.mjs`].
- Ready signal: stderr `WebDriver BiDi listening on ws://…`, plus `<profile>/WebDriverBiDiServer.json` with `ws_host` and `ws_port`, removed on stop [confirmed: `WebDriverBiDi.sys.mjs`].
- Profile: `--profile <path>`, plus `--new-instance` if the user's Firefox is running [confirmed: `nsAppRunner.cpp`].
- First-run screens are suppressed with prefs in `user.js`, not with flags. Puppeteer's set includes `browser.shell.checkDefaultBrowser=false`, `browser.startup.homepage_override.mstone="ignore"`, `browser.startup.page=0` and `datareporting.policy.dataSubmissionEnabled=false` [confirmed: `@puppeteer/browsers` `firefox.ts`].
- Driving it needs a BiDi client, which is a different lane from CDP.

**MSIX file virtualization (Windows).** For virtualized packaged apps on Windows 10 1903 and later, *new* files under `AppData\Local` and `AppData\Roaming` are written to a per-user, per-package private location and merged back only for that app [confirmed: Microsoft "Understanding how packaged desktop apps run on Windows"]. A Yoqa temp profile under `%TEMP%` (inside `AppData\Local`) could therefore be invisible to the runner. Whether Arc and Dia are virtualized depends on their manifests [unverified]. Mitigations: a profile root outside `AppData`, or the stderr `DevTools listening on` line.

## What this means for `chromium-browsers.ts`

- Add `dia` and `arc` (macOS), `opera` and `vivaldi`. For Dia and Arc, look for `DevToolsActivePort` in `<profile>/User Data/` as well as `<profile>/`. Report the ArcCore Chromium version, or the app version labelled as such.
- On `win32`, replace "empty off macOS" with: folder probes, then App Paths, then StartMenuInternet, with `.exe` names and the version folder. The existing `DiscoveryDeps` seam needs a `readRegistry` function. A `reg query` child process is the cheapest route with no native module.
- Treat Firefox as a separate device kind and lane (BiDi), not a `launchChromium` target.
- Decide what to do about the sign-in wall before listing Dia and Arc as usable devices.

## New questions surfaced

1. **Dia and Arc sign-in wall.** A fresh profile is gated by an Atlassian sign-up page with reCAPTCHA. Can a launched instance still be driven over CDP (for example by creating a new target), or are Dia and Arc unusable as throwaway web devices? Yoqa must never solve the CAPTCHA, and must never reuse the user's real profile.
2. **Windows registry reading in the runner.** `reg query` subprocess or a native binding? And which keys exist on a real Windows 11 box for Opera, Vivaldi (including standalone) and Firefox per-user installs?
3. **MSIX browsers on Windows (Arc, Dia).** How are they found (`Get-AppxPackage`), and launched with arguments (an execution alias?)? Does file virtualization hide `DevToolsActivePort` under `%TEMP%`?
4. **Firefox as a web device.** Is a WebDriver BiDi lane in scope, or is Firefox listed as unsupported?

## Sources

- Chromium, user data directory: https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md
- Chrome blog, remote debugging switch changes (Chrome 136): https://developer.chrome.com/blog/remote-debugging-port
- Chromium installer source: `chrome/install_static/google_chrome_install_modes.h`, `chromium_install_modes.h` and `install_modes.cc`; `chrome/installer/util/helper.cc`, `shell_util.cc` and `installation_state.cc`; `chrome/installer/setup/setup_util.cc` and `installer_state.cc`. All on https://chromium.googlesource.com/chromium/src/+/main/
- brave-core: `chromium_src/chrome/install_static/chromium_install_modes.h`, `install_modes.cc`; `chromium_src/chrome/installer/util/util_constants.h`. https://github.com/brave/brave-core
- Microsoft: Application Registration (App Paths): https://learn.microsoft.com/en-us/windows/win32/shell/app-registration
- Microsoft: Registering with the Start Menu (StartMenuInternet): https://learn.microsoft.com/en-us/windows/win32/shell/start-menu-reg and https://learn.microsoft.com/en-us/windows/win32/shell/reg-middleware-apps
- Microsoft: Edge Update policies (app ids, per-user and machine-wide installs): https://learn.microsoft.com/en-us/deployedge/microsoft-edge-update-policies
- Microsoft: how packaged desktop apps run (MSIX AppData virtualization): https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes
- Playwright: `packages/playwright-core/src/server/registry/index.ts` (install paths), `server/chromium/chromiumSwitches.ts` (flags): https://github.com/microsoft/playwright
- Puppeteer: `packages/browsers/src/browser-data/firefox.ts` (Firefox prefs and exe): https://github.com/puppeteer/puppeteer
- Firefox source: `remote/components/RemoteAgent.sys.mjs`, `remote/webdriver-bidi/WebDriverBiDi.sys.mjs`, `toolkit/xre/nsAppRunner.cpp`, `browser/installer/windows/nsis/shared.nsh`, `build/application.ini.in`: https://github.com/mozilla-firefox/firefox
- Mozilla, CDP deprecation (removed in Firefox 141): https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/
- Vivaldi help, install options (per-user, all users, standalone): https://help.vivaldi.com/article/install-the-vivaldi-browser/
- Arc for Windows App Installer manifest: https://releases.arc.net/windows/prod/Arc.appinstaller
- Dia site (macOS and Windows availability): https://www.diabrowser.com/
- Local, this Mac (2026-10-28): `Info.plist` of `Dia.app`, `Google Chrome.app`, `Safari.app` and Dia's `ArcCore.framework`; one throwaway Dia launch as described above.
