# Web: installed browsers as devices, launched by Yoqa

## Goal

Make an installed browser the main way to get a web device ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301), ticket [#308](https://github.com/Aris-ngoy/qa-agent/issues/308)). `yoqa devices web` lists the Chromium-family browsers on this Mac (Chrome, Edge, Brave, Chromium, Dia) even when they are not running, the way shut-down simulators are listed. Connecting one launches a **Yoqa-owned instance** on a throwaway profile, and disconnecting kills it. Attach by port ([web-attach-by-port.md](./web-attach-by-port.md)) still works and never kills a browser Yoqa did not start. Vocabulary: **Browser device**, **Device Session**, **Dead Session** in [`CONTEXT.md`](../../CONTEXT.md). Decision: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

## Plan summary

- **Stable ids, one per browser:** `web-chrome`, `web-edge`, `web-brave`, `web-chromium`, `web-dia`, so saved Runs and scripts keep working across launches.
- **Discovery reads app bundles.** It looks in `/Applications`, then `~/Applications`, for each browser's executable, and reads its version from `Info.plist`. It is macOS only and empty elsewhere. Rejected: asking Spotlight (`mdfind`), which misses browsers on unindexed volumes.
- **Launching is booting.** Connect starts the browser with a fresh `mkdtemp` `--user-data-dir`, `--remote-debugging-port=0`, and flags that suppress first-run, default-browser and search-engine screens, sync and keychain prompts. The port the browser picked is read back from the profile's `DevToolsActivePort`, so no port is guessed or scanned. The user's own profile is never used.
- **The lane owns the instance.** Disconnecting, or connecting another device (which quits the current session), kills the browser and deletes its profile. When the session dies (the browser quits, or its page is closed), nobody quits the dead session, so the lane stops its own instance there too.
- **One lane, two ways in.** The web Direct lane's `cdp` implementation opens either kind of id. Attach keeps its behaviour: disconnecting closes only the DevTools socket.
- **State.** A browser is listed `running` while Yoqa's instance of it is up, else `not running`. `--booted-only` lists just the running ones.

## What shipped

- **Runner**
  - `chromium-browsers.ts`: `findInstalledBrowsers`, `listWebDevices` and `launchChromium`, with a faked filesystem (`DiscoveryDeps`) and process (`spawn`) seam. A browser that exits, or opens no debug port within 15 s, fails the launch with its stderr, is killed, and its profile is deleted.
  - `web-direct-lane.ts`: a `web-*` id launches the installed browser, and `chromium-cdp-<port>` still attaches. An id for a browser that is not installed fails the connect without launching anything.
  - `listDevices("web")` lists the installed browsers as devices of kind `browser`.
- **Tests**
  - `fakeChromium` in `fake-cdp.ts` stands in for the browser process: each spawn starts a faked CDP endpoint and writes its port to `DevToolsActivePort` in the given profile.
  - The Lane contract suite gains `webLaunchedLane`, the real lane launching a faked Chrome. It passes every contract case.
  - `chromium-browsers.test.ts` covers discovery, listing and launch. `web-direct-lane.test.ts` covers connect, disconnect, a missing browser, and the Dead Session paths of an owned instance.
- **CLI**: `yoqa devices connect web-chrome` infers `--platform web`. `yoqa devices web [--json]` lists installed browsers.

### Dia (`web-dia`, #377)

Dia is launched on a Kept profile like the others (#339, decided in #349), so a Mac whose only Chromium browser is Dia has a browser in the picker's Browsers tab and in `yoqa devices web`.

- **Discovery:** `Dia.app`, listed after the four others, with the binary at `Contents/MacOS/Dia` and the version from `CFBundleShortVersionString`.
- **Port file:** Dia writes `DevToolsActivePort` one level down, at `<user-data-dir>/User Data/DevToolsActivePort` (#343), where Chrome writes it at `<user-data-dir>/`. The difference lives in the browser's `KNOWN_BROWSERS` entry (`portFileDir: "User Data"`), the way `chromium-everyday.ts` has `userData: "Dia/User Data"`; the launch deletes a stale port file there and reads the new one there. Rejected: looking in both places for every browser, which would let a stale file in the wrong one pass for a fresh port.
- **Kept profile:** the same rules: `~/.yoqa/browser-profiles/<appId>/web-dia/`, its lock, reset, and `profile: clean`.
- **Sign-up wall:** a fresh Dia profile opens on Dia's sign-up wall, which has a reCAPTCHA the agent cannot pass. Sign in by hand once in the Yoqa-owned window; the Kept profile keeps it, so later connects and Runs skip the wall until the profile is reset (#352).
- **CLI and desktop:** `yoqa devices connect web-dia` needs no `--platform`. The desktop's Browsers tab lists Dia with Reset browser profile, since it filters by id pattern, not by browser.
- **Tests:** `fakeChromium` takes `portFileDir`, and `chromium-browsers.test.ts` checks that Dia's port is read, and a stale one deleted, under `User Data/`, while Chrome's stays in the profile folder.

## How to verify

```bash
bun test services/runner/src/domains/devices/chromium-browsers.test.ts services/runner/src/domains/devices/web-direct-lane.test.ts
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "Web Direct"
bun run lint:ci && bun run test && bun run check
```

By hand, on a Mac with Chrome installed:

```bash
yoqa devices web                 # web-chrome … [not running], even with Chrome closed
yoqa devices connect web-chrome  # a new Chrome window opens on a blank page, no first-run screens
yoqa action open-url --url https://example.com
yoqa screenshot /tmp/page.png
yoqa devices web --booted-only   # web-chrome [running]
yoqa devices disconnect          # that window closes; its /tmp/yoqa-web-* profile is gone
```

Your everyday Chrome, if open, is untouched throughout.

For Dia: `yoqa devices connect web-dia --app <app>` opens Dia on the App's Kept profile, on the sign-up wall the first time. Sign in by hand, disconnect, and connect again: the wall is skipped. Not yet run by hand: this was built on Linux against `fakeChromium`.

## Follow-ups

- The hand check on Dia above (`web-dia`).
- The runner exits without quitting the active session, so a Yoqa-owned browser outlives a runner that is stopped while connected. Quitting sessions on shutdown would fix this for every platform.
- [#310](https://github.com/Aris-ngoy/qa-agent/issues/310): viewport presets on connect (a launched browser still opens at its default window size). [#311](https://github.com/Aris-ngoy/qa-agent/issues/311): browsers in the desktop picker.
