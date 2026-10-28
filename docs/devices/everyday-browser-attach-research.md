# Research: can Yoqa drive the user's everyday browser?

Ticket: [#340](https://github.com/Aris-ngoy/qa-agent/issues/340) (map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). Researched 2026-10-28. This note lives on the throwaway branch `research/everyday-browser-attach` and is never merged.

**Question.** Can Yoqa drive the browser the user already has open, with their real profile and logins, from Chrome, Edge, Brave, Arc, Dia, Opera and Vivaldi, on macOS and Windows? We looked at three routes: the consent-based remote debugging toggle in `chrome://inspect`, a `chrome.debugger` extension, and copying or reusing the profile.

Context: [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md), `services/runner/src/domains/devices/web-direct-lane.ts`, `chromium-browsers.ts` and `chromium-attach.ts`.

Labels used below:

- **Confirmed** means read in vendor docs or in Chromium or tool source.
- **Observed** means checked on this Mac (Chrome 156.0.8078.73 and Dia 1.54.2).
- **Reported** means a third-party issue or blog said it.
- **Unverified** means nobody checked it.

## Answer in short

- **Yes, for Chrome 144+ and Edge, on macOS and Windows, with user consent at two points.** The user turns on "Allow remote debugging for this browser instance" once at `chrome://inspect/#remote-debugging` (`edge://inspect` on Edge). After that, Chrome shows an "Allow remote debugging?" dialog for every new DevTools connection. This mode works on the **default profile**. The Chrome 136 port block does not apply to it.
- **The wire protocol differs from attach-by-port.** There is no HTTP discovery: `/json/version` answers 404. The client reads `DevToolsActivePort` from the browser's own user-data directory and opens the browser WebSocket directly. The socket opens only after the user clicks Allow. A browser-level session keeps the full Target domain, so the CDP surface our lane already uses works unchanged.
- **Brave and Dia carry the code.** Brave is reported working. Dia's binary contains the toggle, the dialog and the pref. Arc, Opera and Vivaldi are unverified.
- **A `chrome.debugger` extension covers every CDP domain the lane needs except `Target` and `Browser`.** On a tab, `Target` is limited to auto-attach, so we would rebuild tab management on `chrome.tabs`. It also means Web Store publishing, a native-messaging host per browser, a "debugger" install warning and a persistent infobar. It is not worth building now.
- **Copying the profile is not a workable path.** On Windows, App-Bound Encryption is used only with the default user-data directory, so a copied profile loses its cookies. On macOS a copy decrypts, but it is a stale snapshot, and it is the very pattern Chrome's hardening targets.

**Recommendation.** Add a consent attach for Chrome and Edge, behind an explicit opt-in, that opens Yoqa's own tab in the user's browser. Keep the Yoqa-owned instance as the default. Offer a *persistent* Yoqa profile (log in once, reused) as the low-friction way to test logged-in flows. Do not build the extension or profile copying now. Details are under [Recommendation](#recommendation-for-yoqa).

---

## 1. Background: why plain attach-by-port fails on the everyday profile

- **Confirmed, Chrome 136 (stable 2025-04-29).** `--remote-debugging-port` and `--remote-debugging-pipe` "will no longer be respected if attempting to debug the default Chrome data directory". They must be paired with a non-default `--user-data-dir`. The stated reason is infostealers using the port to pull cookies after App-Bound Encryption. Chrome for Testing keeps the old behaviour. ([Chrome blog, 2025-03-17](https://developer.chrome.com/blog/remote-debugging-port))
- **Confirmed: the block is a Google-Chrome-branding build gate in Chromium.** `IsRemoteDebuggingAllowed()` in `chrome/browser/devtools/remote_debugging_server.cc` refuses the default user-data directory only `#if BUILDFLAG(GOOGLE_CHROME_BRANDING)`, on Win, Mac and Linux. Other brands skip it unless they patch it in. ([source](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/remote_debugging_server.cc))
  - **Reported, Edge 154 on Windows 11.** Edge enforces the same block: nothing listens, and stderr says "requires a non-default data directory". ([MicrosoftDocs/edge-developer#3970](https://github.com/MicrosoftDocs/edge-developer/issues/3970))
  - **Observed.** Dia's engine binary contains the same message string, but a compiled string does not show that the check runs.
  - **Unverified.** Whether Brave, Opera, Vivaldi or Arc enforce the block on the default profile. Upstream code would let them through, so this needs a hands-on check.
- **Confirmed: the `RemoteDebuggingAllowed` enterprise policy (Chrome 93+) disables every mode when set to false.** That covers the port, the pipe and the consent toggle below. ([policy yaml](https://github.com/chromium/chromium/blob/main/components/policy/resources/templates/policy_definitions/Miscellaneous/RemoteDebuggingAllowed.yaml), and `kDisabledByPolicy` branches in `remote_debugging_server.cc`)

## 2. Consent-based remote debugging of a running browser (the `chrome://inspect` toggle)

### How it works (confirmed from Chromium source)

- Chrome 144 added this mode, announced 2025-12-11. M144 reached stable on 2026-01-13 ([ChromiumDash](https://chromiumdash.appspot.com/schedule)). ([Chrome blog](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session))
- The feature flag `kDevToolsAcceptDebuggingConnections` is **enabled by default on every desktop platform except ChromeOS**, so macOS and Windows both have it (`chrome/browser/devtools/features.cc`). It is compiled out on Android.
- The user's choice is the Local State pref `devtools.remote_debugging.user-enabled` (`chrome/common/pref_names.h`). It is application-wide, not per profile: "the debugging server is global". It persists across restarts. We can read it from `<user-data-dir>/Local State` and give a precise "turn it on first" error.
- When the pref is on and no `--remote-debugging-port`/`--remote-debugging-pipe` was passed, Chrome starts its HTTP server in `RemoteDebuggingServerMode::kWithApprovalOnly`. It writes the port to `DevToolsActivePort` in the user-data directory. **This path does not call the default-user-data-dir check**, so it works on the everyday profile (`MaybeStartOrStopServerForPrefChange`, `GetInstance` in `remote_debugging_server.cc`). The port flag and pipe flag take precedence over this mode when present.
- In approval mode (`content/browser/devtools/devtools_http_handler.cc`):
  - `/json*`, the discovery page and frontend resources answer **404**.
  - A WebSocket upgrade to `/devtools/browser…` triggers `delegate_->AcceptDebugging(...)`, which is the user prompt. The handshake completes only after approval.
  - Upgrades to any other path, such as page targets, get **403 "Connection rejected"**.
  - A Chrome DevTools MCP maintainer confirms this: "HTTP access does not have long running connections like websockets and each connection needs to be approved" ([chrome-devtools-mcp#3077](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/3077)).
- **Every new WebSocket connection prompts again.** Maintainers have declined a "remember" option: without it, "any program on the machine [could] easily access your data". Their advice is to keep long-lived connections ([chrome-devtools-mcp#825](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/825)).
  - **Reported.** Short connect timeouts with retries stack up several prompts ([microsoft/vscode-js-debug#2435](https://github.com/microsoft/vscode-js-debug/issues/2435), [chrome-devtools-mcp#1794](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1794)).

### What Chrome DevTools MCP's `--autoConnect` does (confirmed)

- Docs: "In Chrome (>= M144)… Navigate to `chrome://inspect/#remote-debugging` to enable remote debugging… use `--autoConnect`… It shows a dialog asking for user permission." With several profiles open, it connects to "the default profile (as determined by Chrome)". ([advanced-usage.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md))
- In code, `src/BrowserManager.ts` reads `<userDataDir>/DevToolsActivePort`, builds `ws://127.0.0.1:<port><path>` and calls `puppeteer.connect({browserWSEndpoint})`. Without a `userDataDir`, it passes `channel` to Puppeteer, which resolves that channel's default user-data directory and does the same. It never uses HTTP discovery. ([source](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/BrowserManager.ts))
- Microsoft documents the same flow for Edge (Learn page, updated 2026-09-02):
  - Select **"Allow remote debugging for this browser instance"** on `edge://inspect` → Remote debugging.
  - Run `--autoConnect --user-data-dir=<Edge user data dir>`.
  - User-data directories:
    - Windows: `%LOCALAPPDATA%\Microsoft\Edge\User Data` (Beta/Dev/`Edge SxS` for the other channels).
    - macOS: `~/Library/Application Support/Microsoft Edge` (plus ` Beta`/` Dev`/` Canary`).
  - The page warns: "your agent inherits your active session, including logged-in accounts, cookies, and other data… This may expose Personally Identifiable Information (PII)".

  ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/devtools-mcp-server))

### What the user sees (confirmed and observed)

These strings come from Chrome 156's `en.lproj/locale.pak` on this Mac. Dia 1.54.2 ships the identical strings.

1. **The one-time toggle.** The checkbox reads "Allow remote debugging for this browser instance" (wording from Microsoft Learn and third-party reports).
2. **The dialog on each connection.** Title: **"Allow remote debugging?"** Body: *"An external app wants full control over this Chrome session to debug it. This includes access to your saved data, cookies and site data, and the ability to navigate to any URL."* Footer: *"Only web developers should turn on this feature, and only use it with trusted apps."* Buttons: Allow / Deny, plus a "Turn off in settings" link.
3. **During the session.** The "Chrome is being controlled by automated test software" banner appears ([Chrome blog](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)).

### Which browsers have it

| Browser | macOS | Windows | Status |
|---|---|---|---|
| Chrome ≥ 144 | yes | yes | **Confirmed** (Chrome blog, Chromium source; flag on for all desktop but ChromeOS). Observed in Chrome 156.0.8078.73 on macOS. |
| Edge (Chromium 144+ base) | yes | yes | **Confirmed** by Microsoft Learn, which gives user-data-dir paths for both OSes. Reported working on Edge 154/Windows 11 ([#3970](https://github.com/MicrosoftDocs/edge-developer/issues/3970)). |
| Brave | reported | unverified | **Reported**: `brave://inspect/#remote-debugging` works, `/json/version` answers 404, and the pref is stored in Local State. That report was on Linux, Brave "based on Chromium 154" ([blog](https://pedrosatin.com/en/blog/brave-remote-debugging-authorization/)). No Brave docs. Third-party tools list `~/Library/Application Support/BraveSoftware/Brave-Browser` for it ([browser-use/browser-harness#687](https://github.com/browser-use/browser-harness/issues/687)). |
| Dia | likely | n/a (macOS-only) | **Observed**: Dia 1.54.2 embeds Chromium 156.0.8078.48 in `ArcCore.framework`. The binary contains `kDevToolsAcceptDebuggingConnections`, `devtools.remote_debugging.user-enabled`, `DevToolsActivePort` and the "Allow remote debugging?" dialog strings. **Unverified** whether Dia exposes the `chrome://inspect` toggle in its UI and writes `DevToolsActivePort` to `~/Library/Application Support/Dia/User Data`, the path third-party tools use. |
| Arc | unverified | unverified | Same `ArcCore` engine family as Dia. Third-party tools list `~/Library/Application Support/Arc/User Data`. No vendor docs. Arc is in maintenance mode, and its Chromium base would need to be ≥ 144. |
| Opera | unverified | unverified | No vendor docs found. It would need a Chromium 144+ base and an unpatched `inspect` page. |
| Vivaldi | unverified | unverified | No vendor docs found. Same conditions as Opera. |
| Chromium / Chrome for Testing | yes | yes | Same code. Also not subject to the default-profile port block (no Google branding). |

### What it means for our lane (checked against our code)

- The lane already talks to the **browser** socket and drives pages with `Target.attachToTarget({flatten: true})` plus `sessionId` (`web-direct-lane.ts`). An approved browser socket is a full browser-level session, so `Target.createTarget`, `getTargets`, `setDiscoverTargets`, `closeTarget` and every page command we send keep working.
- `chromium-attach.ts` discovers the socket via `/json/version`, which **404s in approval mode**. A consent attach must use the `DevToolsActivePort` route instead, and `chromium-browsers.ts` already has a `readActivePort()` for its owned instances.
- `cdp-client.ts` has `CONNECT_TIMEOUT_MS = 5_000`. Approval needs a human click, so the consent connect needs a long, cancellable wait, around a minute, with **no retry loop**: each retry is a new prompt.
- Hold one socket for the whole Device Session. A reconnect prompts again. A closed socket is a Dead Session (ADR-0001/0007), and the user re-approves on the next connect.
- Open Yoqa's **own** tab or window with `Target.createTarget` and close only that on disconnect. Never drive or emulate the user's existing tabs. Viewport presets (`Emulation.*`) then affect only our tab.
- Installed-browser discovery in `chromium-browsers.ts` is macOS-only today ("Empty off macOS"). A Windows consent attach needs the per-brand `%LOCALAPPDATA%` user-data paths.

## 3. A browser extension using `chrome.debugger`

- **Confirmed API facts** ([chrome.debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger)):
  - Requires the `"debugger"` permission. Available domains: Accessibility, Audits, CacheStorage, Console, CSS, Database, Debugger, DOM, DOMDebugger, DOMSnapshot, Emulation, Fetch, IO, Input, Inspector, Log, Network, Overlay, Page, Performance, Runtime, Storage, Target, Tracing, WebAudio, WebAuthn. **`Browser` is not available.**
  - Flat sessions and child targets (`sessionId` in `sendCommand`) since **Chrome 125**.
  - `attach` fails with "Screenshot capture is restricted by policy" when enterprise policy blocks screenshots.
- **Confirmed: `Target` is restricted on a tab.**
  - An extension client's `IsTrusted()` is false for every extension except the Perfetto UI one (`ExtensionIsTrusted` in `chrome/browser/extensions/api/debugger/debugger_api.cc`).
  - `RenderFrameDevToolsAgentHost` then builds its `TargetHandler` with `AccessMode::kAutoAttachOnly` (`content/browser/devtools/render_frame_devtools_agent_host.cc`).
  - In that mode `setDiscoverTargets`, `attachToTarget`, `getTargets`, `createTarget`, `activateTarget` and `closeTarget` return "Not allowed" (`content/browser/devtools/protocol/target_handler.cc`).
  - Extensions cannot attach to WebUI (`chrome://`) pages or other extensions' pages. `file://` needs the user's "Allow access to file URLs" toggle (`debugger_api.cc`).
- **Coverage of the lane's CDP surface.** We checked every CDP method the runner sends.

  | Lane needs | Over `chrome.debugger` |
  |---|---|
  | Screenshot (`Page.captureScreenshot`) | Yes (Page domain) |
  | Accessibility tree (`Accessibility.getFullAXTree`) | Yes |
  | DOM snapshot (`DOMSnapshot.captureSnapshot`) | Yes |
  | Input (`Input.dispatchMouseEvent`/`KeyEvent`/`TouchEvent`/`insertText`) | Yes |
  | Emulation (`setDeviceMetricsOverride`, `setTouchEmulationEnabled`, `setUserAgentOverride`) | Yes |
  | Navigate, dialogs, load events (`Page.navigate`, `handleJavaScriptDialog`, …) | Yes |
  | Tabs and popups (`Target.createTarget`/`getTargets`/`attachToTarget`/`closeTarget`/`setDiscoverTargets`) | **No.** Rebuild on `chrome.tabs.create`/`onCreated` (`openerTabId`)/`remove` plus one `chrome.debugger.attach({tabId})` per tab |
  | `Browser.getVersion` (report names the browser) | **No.** Use `navigator.userAgentData` or the extension's own runtime |

- **Plumbing.** The extension has to reach the runner. The usual route is a native messaging host. Its manifest is registered per browser:
  - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (and the Chromium equivalent).
  - Windows: `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>`.
  - `allowed_origins` takes exact extension IDs, no wildcards.

  ([native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)) Each fork has its own registration location (unverified per fork), and the extension has to be published to the Chrome Web Store (and the Edge Add-ons store) to be installable by normal users.
- **What the user grants and sees:**
  - At install, Chrome warns "Access the page debugger backend" and "Read and change all your data on all websites" ([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)).
  - Each attach shows the infobar **"“<extension name>” started debugging this browser"** (string observed in Chrome 156 and Dia locale.pak). Cancelling the infobar detaches.
  - Native messaging adds "Communicate with cooperating native applications".
- **Fork reach (unverified per fork).** Edge, Brave, Opera, Vivaldi, Arc and Dia can generally install Chrome Web Store extensions, so this route reaches forks that lack the consent toggle. That reach is its only real advantage over section 2.

## 4. Copying or reusing the profile

- **Locks (confirmed).**
  - One process owns a user-data directory through a process singleton: `SingletonLock`/`SingletonSocket`/`SingletonCookie` on POSIX (`chrome/common/chrome_constants.h`), and a `lockfile` plus a mutex on Windows (`chrome/browser/process_singleton_win.cc`). A second launch on the same directory hands off to the running browser, so reusing the live directory in place is impossible.
  - Chromium's SQLite stores support `exclusive_database_file_lock`, a Windows file-sharing lock that stops any other process opening the file (`sql/database.h`). The cookie store passes this through. **Unverified** whether it is on by default for cookies; if it is, copying `Network\Cookies` while Edge or Chrome runs fails.
- **macOS (confirmed and inferred).**
  - Cookies are encrypted with a key held in the Keychain under a fixed per-brand service name, "Chrome Safe Storage" for Google Chrome and "Chromium Safe Storage" otherwise (`components/os_crypt/common/keychain_password_mac.mm`). The name does not depend on the user-data directory.
  - So a copy launched by the same browser app should decrypt (inferred from source, not tested), and that copy can then take `--remote-debugging-port`.
  - If Yoqa itself reads the item, macOS shows a Keychain access prompt.
  - The copy is a snapshot: sessions diverge or rotate, and the user's real browser state is not what gets tested.
- **Windows (confirmed).**
  - App-Bound Encryption (Chrome 127+) binds the cookie key to the app identity through a SYSTEM service, and "strongly binds the encryption key to the machine" ([Google Security blog, 2024-07-30](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html)).
  - `GetAppBoundEncryptionSupportLevel()` returns `kNotUsingDefaultUserDataDir` for any non-default directory, and requires a system-level install (`chrome/browser/os_crypt/app_bound_encryption_win.cc`). This matches the Chrome 136 post: "A non-standard data directory uses a different encryption key".
  - So a copied profile run from another directory cannot decrypt its app-bound cookies, and the user arrives logged out (inferred from source, not tested).
- **Verdict.** Not viable on Windows. Fragile on macOS. On both it is the infostealer technique Chrome's 127 and 136 hardening targets, and a QA tool should not ship it.

## Recommendation for Yoqa

1. **Add a consent attach for Chrome and Edge, behind explicit opt-in.**
   - The user turns on the toggle once and approves the dialog per connection.
   - Yoqa resolves the brand's default user-data directory per OS, reads `Local State` to check `devtools.remote_debugging.user-enabled` (the source of a precise error), and reads `DevToolsActivePort`.
   - It connects to the browser socket with one long, cancellable attempt, then opens its own tab or window.
   - Brave, Dia and Arc fit the same code once someone checks them by hand. Each needs only its own user-data path.
   - This revisits the ADR-0007 line "attaching to a user's everyday browser would put the agent in their logged-in session", so it needs a decision and copy that repeats Microsoft's PII warning.
2. **Keep Yoqa-owned instances as the default, and add a persistent Yoqa profile.** That is a named, reused `--user-data-dir` where the user logs in once. It has no prompts, no banner beyond the usual one, and no exposure of the everyday profile. It covers most "test my logged-in app" needs.
3. **Defer the `chrome.debugger` extension.** It would need a store listing, a native host per browser, a `Target` replacement on `chrome.tabs`, a no-`Browser`-domain workaround, a scary install warning and a persistent infobar. Revisit only if users need a fork with no consent toggle.
4. **Do not copy profiles.**

## Newly surfaced questions

- **Decision (product and security).** Should Yoqa offer a live attach to the everyday logged-in profile at all? ADR-0007 rejected attaching to the everyday browser. This needs an ADR amendment and consent and warning UX.
- **Spike.** Hands-on check of the consent toggle and `DevToolsActivePort` location on Brave, Arc, Dia, Opera and Vivaldi, on macOS and Windows. Also whether those forks enforce the default-profile port block, which upstream gates on Google branding only.
- **Engineering.** The CDP client needs an approval-aware connect: a long timeout, no retry, cancellable, and a clear Deny/403 error. Installed-browser discovery and user-data paths on Windows are needed too, since `chromium-browsers.ts` is macOS-only.
- **Multiple profiles.** The approval server is browser-wide. Which profile does `Target.createTarget` open in when several are open? chrome-devtools-mcp says "the default profile (as determined by Chrome)". `Target.createTarget` takes a `browserContextId`, so check whether profiles appear as contexts.
- **Persistent Yoqa profile.** Is a reusable, named Yoqa profile wanted as the main "logged-in testing" story? It is cheaper and safer than a live attach.
