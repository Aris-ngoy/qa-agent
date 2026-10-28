# Research: can Safari be a Browser device, and keep logins?

Ticket: [#342](https://github.com/Aris-ngoy/qa-agent/issues/342) (map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). Researched 2026-10-28 on macOS 27.0.1 (26A434) with Safari 27.0.1. This is a throwaway research note. It is not a design doc and is never merged.

## Short answer

- **Safari can be driven, but only through `safaridriver`, and its sessions never see the user's logins.** Apple states that a WebDriver session runs in a special automation window, isolated from normal browsing data, that "always starts from a clean slate", like a private browsing session. The login goal (reuse the user's signed-in Safari) is therefore **not reachable** through any Apple-supported path.
- **It does not fit ADR-0005 / ADR-0007 as they stand.** `safaridriver` is a W3C WebDriver HTTP server (plus an optional WebDriver BiDi WebSocket). It is Apple's own tool, but it is exactly the "WebDriver server in between" that [ADR-0005](../adr/0005-direct-only-lane.md) removed and [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md) avoided. Taking it on means amending those ADRs.
- **There is no supported non-WebDriver path.** On macOS, Safari's Web Inspector is reached over a private XPC Mach service (`com.apple.webinspector`, served by `webinspectord`), not a socket. Apple documents no client API for it.
- **Recommendation: do not add Safari as a Browser device now.** If cross-browser coverage is wanted later, scope it as a "Safari over WebDriver BiDi" ADR amendment that gives up logins. Tests would sign in on their own or seed cookies.

## Findings

### 1. `safaridriver` and the "Allow Remote Automation" setting

- **Confirmed.** `safaridriver` ships at `/usr/bin/safaridriver`, and each Safari and Safari Technology Preview has its own copy ([Apple: Testing with WebDriver in Safari](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)). Locally, `safaridriver --version` prints `Included with Safari 27.0.1 (22625.1.29.11.28)`.
- **Confirmed.** WebDriver support is off by default. On High Sierra and later you enable it once with `safaridriver --enable` (Apple, same page). The man page (`man safaridriver`) says `--enable` "includ[es] checking 'Enable Remote Automation' in Safari's Develop menu. The user must authenticate via password." In Safari 27 the setting is labelled "Allow remote automation and external agents" under Settings > Developer ([WebKit: Introducing the Safari MCP server](https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/)).
  - Consequence for Yoqa: the first connect needs a one-time, password-gated user step that Yoqa cannot do silently. Doctor would have to detect it and explain it. Not tested here: the ticket said not to change system settings.
- **Confirmed (man page).** The HTTP server "accepts connections from localhost only." That matches ADR-0007's localhost-only attach.

### 2. Isolation from the user's cookies and logins (the deciding point)

- **Confirmed (Apple primary doc).** [About WebDriver for Safari](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari) says test execution is confined to "special automation windows that are isolated from normal browsing windows, user settings, and preferences". You can recognise them by an orange Smart Search field. The page goes on: "Like a private browsing session, an automation session always starts from a clean slate. It can't access Safari's browsing history, AutoFill data, or other sensitive information."
- **Confirmed (WebKit source).** In WebKit `main`, BiDi `browser.createUserContext` asserts that the new context's data store is not persistent: `ASSERT(!userContext->dataStore().isPersistent())` in [`BidiBrowserAgent.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Automation/BidiBrowserAgent.cpp). Extra user contexts are ephemeral too.
- **Confirmed (Apple doc).** Apple says isolated sessions "help to ensure that tests are unaffected by a previous test session's persistent state", so even a login done inside one session is gone in the next.
- **No capability selects a profile.** The man page lists every capability Safari supports (`browserName`, `browserVersion`, `platformName`, `safari:*`, `acceptInsecureCerts`, `webauthn:virtualAuthenticators`, `webkit:*`). None of them picks a Safari Profile or a persistent data store. Unlike Chromium's `--user-data-dir`, there is nothing to point at a prepared profile.
- **Unverified.** The Safari MCP server (`safaridriver --mcp`, Safari 27) is described as connecting "to a Safari browser window", and WebKit says it "does not have access to your personal information in Safari" ([WebKit: Safari 27.0 features](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)). Neither Apple nor WebKit says whether it uses the isolated automation window or a normal window with live cookies. Both third-party write-ups checked are silent on this. It is not tested here because enabling it changes a system setting.
- **What remains for logins:** a Case signs in itself, or the lane seeds auth cookies with WebDriver Add Cookie / BiDi `storage.setCookie` ([BidiStorage.json](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Automation/protocol/BidiStorage.json)). Cookie seeding does not cover `localStorage` or IndexedDB tokens, and it has to be redone in every session.

### 3. One session at a time

- **Confirmed.** "Only one Safari browser instance can be active at any given time, and only one WebDriver session at a time can be attached to the browser instance" ([About WebDriver for Safari](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari)). The man page adds that you should not run several `safaridriver` instances.
- Fit: this lines up with per-device exclusivity ([ADR-0001](../adr/0001-device-session-ownership.md)), but Safari on a Mac is one device. Yoqa could never run two Safari sessions in parallel, while it can with Chromium instances that each have their own profile.
- **Confirmed.** A "glass pane" blocks user input on the automation window. If the user "breaks" it, "the test's connection to the browser is permanently severed" (Apple, same page). For Yoqa that is a Dead Session. The Inspector's manual taps would still work, because they go through the lane rather than the user's mouse.

### 4. Screenshot, tree and input coverage compared with what the web lane uses

The current lane ([`web-direct-lane.ts`](../../services/runner/src/domains/devices/web-direct-lane.ts)) uses CDP `Page.captureScreenshot`, `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`, `Input.dispatchMouseEvent` / `dispatchTouchEvent` / `dispatchKeyEvent` / `insertText`, `Emulation.setDeviceMetricsOverride` / `setTouchEmulationEnabled` / `setUserAgentOverride`, `Page.handleJavaScriptDialog`, `Target.*` popup tracking, and `Storage.clearDataForOrigin`.

| Need | Safari equivalent | Status |
|------|-------------------|--------|
| Viewport screenshot | Classic `Take Screenshot` / `Take Element Screenshot` (Safari 12+, [command table](https://developer.apple.com/documentation/webkit/macos-webdriver-commands-for-safari-12-and-later)). BiDi `browsingContext.captureScreenshot` is "initial support" in [STP 254](https://webkit.org/blog/18420/release-notes-for-safari-technology-preview-254/) (Oct 2026). | Confirmed |
| Full accessibility tree | **None.** The Automation protocol has only per-element `getComputedRole` / `getComputedLabel` ([Automation.json](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Automation/Automation.json)). BiDi has `browsingContext.locateNodes` and script evaluation, but no AX tree. A Screen would have to be built from an injected DOM walk via `script.evaluate`, which approximates roles. | Confirmed gap |
| Mouse, wheel, keys | W3C Perform Actions. On Cocoa, WebKit enables `WEBDRIVER_MOUSE_INTERACTIONS` and `WEBDRIVER_WHEEL_INTERACTIONS` only for `PLATFORM(MAC)`, and keyboard on every platform ([PlatformEnableCocoa.h](https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/PlatformEnableCocoa.h)). | Confirmed |
| Touch, mobile Viewport preset | `WEBDRIVER_TOUCH_INTERACTIONS` is `PLATFORM(IOS_FAMILY)` only, so there is **no touch on macOS Safari**. There is no user-agent or device-metrics override in classic WebDriver (only Set Window Rect). BiDi `browsingContext.setViewport` exists in WebKit `main`. Not confirmed in stable. | Confirmed gap (touch); unverified (setViewport in stable) |
| JS dialogs as alerts | Classic Accept/Dismiss/Get/Send Alert Text; BiDi `handleUserPrompt` + `userPromptOpened` event. | Confirmed |
| Popups | Window handles (classic). BiDi `contextCreated` / `contextDestroyed` events. | Confirmed in source; unverified in stable |
| Clear origin data | Delete All Cookies (cookies only). Session isolation makes the rest moot. | Confirmed |

### 5. WebDriver BiDi status

- **Confirmed locally.** Safari 27.0.1's `safaridriver --help` lists `-b, --bidi <port>`: "If specified, all sessions hosted by this instance will have WebDriver BiDi support enabled." It also lists `--mcp`. The 2017 man page documents neither, so it is stale.
- **Confirmed (source).** WebKit `main` implements the BiDi modules `browser` (user contexts), `browsingContext` (create, navigate, getTree, captureScreenshot, locateNodes, setViewport, handleUserPrompt + navigation and prompt events), `input` (performActions, setFiles), `script` (evaluate, callFunction, preload scripts), `storage` (cookies), plus `session`, `log` and `permissions` ([protocol dir](https://github.com/WebKit/WebKit/tree/main/Source/WebKit/UIProcess/Automation/protocol)).
- **Unverified.** How much of that ships in stable Safari 27.0.1. The release notes for [Safari 26.2](https://developer.apple.com/documentation/safari-release-notes/safari-26_2-release-notes) and [Safari 27](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes) list classic WebDriver changes (Storage Access endpoints, Digital Credentials, a full-page screenshot fix, the Safari MCP server) and no BiDi entries. STP 253 and 254 show BiDi still being filled in, with `captureScreenshot` only reaching "initial support" in October 2026. Treat BiDi in stable as partial or preview.

### 6. Is there a non-WebDriver path?

- **Confirmed (source).** On Cocoa, WebKit's remote inspector talks to `webinspectord` over XPC: `xpc_connection_create_mach_service(WIRXPCMachPortName, …)` with `WIRXPCMachPortName = "com.apple.webinspector"` ([RemoteInspectorConstants.h](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/inspector/remote/RemoteInspectorConstants.h), [RemoteInspectorCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/inspector/remote/cocoa/RemoteInspectorCocoa.mm)). WebDriver sessions travel the same channel (`WIRAutomationSessionRequestMessage`).
- **Confirmed (absence).** Apple publishes no client API or documentation for that service. The WebKit inspector protocol has no published stability promise. The socket-based remote inspector belongs to the GTK and WPE ports, not to Safari. Driving it would mean a private, unversioned macOS interface that might also need entitlements. It is not a product path.
- **Not a path either:** the Safari MCP server is a stdio JSON-RPC tool surface meant for coding agents, not a typed device protocol, and it still sits behind the same remote-automation setting.

## Fit against the ADRs

- [ADR-0005](../adr/0005-direct-only-lane.md) says "no WebDriver server in between." `safaridriver` is one: classic is HTTP REST and BiDi is a WebSocket, both hosted by `safaridriver`. This is unlike Chromium, where CDP is served by the browser itself. Calling `safaridriver` "the platform's own tooling" is arguable, since Apple ships it in the OS and there is no other supported path. The ADR's wording would still need an amendment, and that is the user's design call.
- [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md) already lists Safari as out of scope, and rejects "attach to a user's everyday browser". Safari's isolation enforces that rejection anyway.
- If adopted, the cheapest shape is our own small BiDi client (WebSocket JSON, the same style as the CDP client) inside the Direct lane, implementation `safari-bidi`, with no Selenium or WebdriverIO dependency.

## Newly surfaced questions

1. Does the Safari 27 MCP server (`safaridriver --mcp`) drive an isolated automation window, or a normal window with live cookies? This is the only Apple path that might reach logins. It needs a hands-on test with the setting enabled, by the user.
2. Which BiDi commands actually work in stable Safari 27.x (`setViewport`, `locateNodes`, `contextCreated`, `script.evaluate`)? It needs a spike against `safaridriver --bidi`.
3. Would the user accept an ADR-0005 amendment that treats an OS-bundled WebDriver/BiDi server as "platform tooling" for Safari only?
4. Could a DOM-walk Screen (no AX tree) meet the Screen contract and Tree assist quality, or would Safari be screenshot and vision only?
