# Research: can Firefox be a Browser device over WebDriver BiDi?

Research note for [#341](https://github.com/Aris-ngoy/qa-agent/issues/341) (map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). Throwaway branch, never merged. Vocabulary: **Browser device**, **Device Session**, **Screen** in [`CONTEXT.md`](../../CONTEXT.md). Decisions in play: [ADR-0005](../adr/0005-direct-only-lane.md), [ADR-0007](../adr/0007-web-direct-lane-over-cdp.md).

Researched 2026-10-28. Current Firefox is 154 or later (154 shipped 2026-08-18, [MDN release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/154)). The spec read is the WebDriver BiDi Editor's Draft of 8 October 2026 ([w3c.github.io/webdriver-bidi](https://w3c.github.io/webdriver-bidi/)).

## Answer

**Partly.** Firefox exposes WebDriver BiDi directly from the browser process, with no geckodriver, and it covers launch, port read-back, screenshots, mouse, wheel and key input, viewport with device pixel ratio, user-agent override, popups, dialogs and navigation. Three things the web lane needs today have no BiDi equivalent in Firefox:

1. **No accessibility tree.** BiDi has no command to dump the tree, and no command returns element boxes. This is the Screen's main input, so it is the blocker.
2. **No touch emulation.** `emulation.setTouchOverride` is in the spec, but Firefox has not implemented it. Touch *input* actions exist.
3. **No per-origin storage clear.** BiDi storage covers cookies only. `restart-app` clears all storage for the origin today.

It fits ADR-0005 in substance: nothing sits between the lane and the browser. But ADR-0005 says "the runner has no WebDriver client", and ADR-0007 says "Firefox, Safari and remote CDP endpoints are out of scope". Both need a new ADR before any build.

**Recommendation:** do not build a Firefox lane yet. First, spike a page-script Screen source over `script.callFunction` (see [The accessibility tree gap](#the-accessibility-tree-gap)) and diff it against Chrome's AX tree on the Expo demo. Build only if that diff is acceptable. Ship desktop presets first, since mobile presets lack touch emulation, and set the minimum at Firefox 145.

Legend: **Confirmed** means a primary source states it. **Unverified** means it is inferred, or the sources conflict, or nobody has tried it on a real Firefox. Firefox is not installed on the research machine, so nothing below was run.

## 1. Launch, port read-back, minimum version

| Question | Finding | Status |
|---|---|---|
| Built in, no driver? | The Remote Agent inside Firefox serves BiDi over a WebSocket. It starts **only** with the `--remote-debugging-port` flag. The default port is 9222 on localhost ([Security.html](https://firefox-source-docs.mozilla.org/remote/Security.html)). A BiDi-only session (no WebDriver classic session, no geckodriver) is supported: connect to `ws://127.0.0.1:<port>/session` and send `session.new` ([MDN: Create a BiDi connection](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection); spec §"Establishing a connection"). | Confirmed |
| CDP still an option? | No. CDP was off by default from Firefox 129 and removed in Firefox 141, together with the `remote.active-protocols` pref. "WebDriver BiDi is the only available protocol" ([Prefs.html](https://firefox-source-docs.mozilla.org/remote/Prefs.html), [fxdx.dev: CDP retirement](https://fxdx.dev/cdp-retirement-in-firefox/)). So the existing CDP client cannot be reused. | Confirmed |
| Free port | `--remote-debugging-port 0` makes the system pick a port ([MDN](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection)). | Confirmed |
| Port read-back | Firefox writes **`WebDriverBiDiServer.json`** to the profile directory, with keys `ws_host` and `ws_port`. Mozilla's own wdspec harness launches with `--remote-debugging-port 0`, polls for that file, and reads both keys ([helpers.py](https://searchfox.org/mozilla-central/source/testing/web-platform/mozilla/tests/webdriver/support/helpers.py)). The file replaced `WebDriverBiDiActivePort` in [bug 1792875](https://bugzilla.mozilla.org/show_bug.cgi?id=1792875), fixed in Firefox 109. This is the same pattern as Chromium's `DevToolsActivePort` in `chromium-browsers.ts`. Fallback: stderr prints `WebDriver BiDi listening on ws://127.0.0.1:<port>` (MDN). | Confirmed (no official schema beyond the two keys) |
| Host and Origin checks | By default the agent accepts only connections with **no `Origin` header** and a `Host` that is an IP or loopback. `--remote-allow-hosts` and `--remote-allow-origins` widen this ([Security.html](https://firefox-source-docs.mozilla.org/remote/Security.html)). Firefox uses `127.0.0.1`, not `localhost` (MDN). Whether Bun's `WebSocket` client sends an `Origin` header needs a check. | Confirmed / Bun behaviour unverified |
| macOS launch | `/Applications/Firefox.app/Contents/MacOS/firefox --remote-debugging-port 0 -profile <dir> -no-remote about:blank` (MDN gives the binary path; `-no-remote` is what Mozilla's harness passes). Discovery can read `Info.plist` for the version, as for Chromium browsers. | Path and port flag confirmed; full flag set unverified |
| Windows launch | `C:\Program Files\Mozilla Firefox\firefox.exe` with the same flags. On Windows the JSON file is the safer read-back, because `firefox.exe` is a GUI-subsystem binary and capturing its stderr is less certain. No Windows-specific Mozilla doc was found. | Unverified |
| Startup prefs | `remote.prefs.recommended` (default `true`) applies automation prefs at startup, such as disabling updates, Telemetry and first-run UX, with user prefs taking precedence ([Prefs.html](https://firefox-source-docs.mozilla.org/remote/Prefs.html)). Whether these are written into a persistent profile's `prefs.js` is not documented. | Unverified |
| Minimum version | **145**: `emulation.setUserAgentOverride` first shipped there ([newsletter 145](https://fxdx.dev/firefox-webdriver-newsletter-145/)), and mobile presets need it. Other floors: `browsingContext.activate` 118 ([bug 1841004](https://bugzil.la/1841004)), `setViewport.devicePixelRatio` 127 ([bug 1857961](https://bugzilla.mozilla.org/show_bug.cgi?id=1857961)), `userPromptOpened.defaultValue` always set for prompts in 129 ([bug 1859814](https://bugzilla.mozilla.org/show_bug.cgi?id=1859814)), and BiDi-only from 141. ESR 140 is below the floor. | Confirmed per feature; overall floor is inferred |

## 2. Persistent profile that keeps logins

- Firefox takes `-profile <dir>`. A directory Yoqa keeps between launches (for example under the app data folder, one per Browser device) keeps cookies, logins and storage the way any Firefox profile does. Mozilla's harness drives Firefox on an explicit profile directory, and `session.new` returns `moz:profile` ([Extensions.html](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html)). **Confirmed** that BiDi runs on a caller-chosen profile.
- Chrome 136 and later refuse remote debugging on the default profile (ADR-0007). No Mozilla source found says Firefox has the same rule. **Unverified.** Using the user's everyday profile is still a bad idea for the reason ADR-0007 gives.
- A profile that another Firefox has open is locked, and without `-no-remote` a second launch can hand off to the running instance instead of starting one. Yoqa should own the profile directory and always pass `-no-remote`. **Unverified** for Firefox 154 or later; this is long-standing Firefox behaviour, not checked in docs this round.
- Session-scoped isolation without a new profile: `browser.createUserContext` (a container) gives a clean cookie and storage jar inside one browser (spec, browser module). This is useful for `restart-app`, see section 3.

## 3. Command-by-command map from the CDP lane

Each CDP command that `web-direct-lane.ts` and `cdp-client.ts` send, with its BiDi replacement. References are to the spec unless noted.

| Lane use | CDP today | BiDi in Firefox | Status |
|---|---|---|---|
| Pick or open a page | `Target.getTargets`, `Target.createTarget` | `browsingContext.getTree`, `browsingContext.create {type: "tab"}` | Confirmed |
| Attach to a page | `Target.attachToTarget {flatten}` | Not needed. Commands take a `context` id. | Confirmed |
| Event delivery | `Page.enable`, `Target.setDiscoverTargets` | `session.subscribe` to `browsingContext.*` events | Confirmed |
| Viewport preset | `Emulation.setDeviceMetricsOverride {width, height, deviceScaleFactor, mobile}` | `browsingContext.setViewport {viewport: {width, height}, devicePixelRatio}` (Firefox 127 or later). There is no `mobile` flag: no meta-viewport or overlay-scrollbar emulation. The spec now has `emulation.setViewportMetaOverride` and `setScrollbarTypeOverride`; Firefox support was not found. | Confirmed (w, h, DPR); `mobile` is a gap |
| Touch emulation | `Emulation.setTouchEmulationEnabled {maxTouchPoints: 5}` | `emulation.setTouchOverride {maxTouchPoints}` is in the spec, but **not implemented in Firefox**: [bug 2006347](https://bugzilla.mozilla.org/show_bug.cgi?id=2006347) is NEW with no milestone. Pages that feature-detect touch (`ontouchstart`, `maxTouchPoints`, `pointer: coarse`) will see a desktop. | **Gap**, confirmed |
| Mobile user agent | `Emulation.setUserAgentOverride` | `emulation.setUserAgentOverride {userAgent, contexts}` (Firefox 145 or later) | Confirmed |
| Bring to front | `Page.bringToFront` | `browsingContext.activate` (Firefox 118 or later). Whether a background tab still paints for `captureScreenshot` in Firefox is not documented. | Confirmed / background capture unverified |
| Navigate and wait | `Page.navigate`, `Page.loadEventFired` | `browsingContext.navigate {url, wait: "complete"}`, or the `browsingContext.load` event. Failures come as `browsingContext.navigationFailed` or a command error, not `errorText`. | Confirmed |
| Screenshot | `Page.captureScreenshot {format: png}` | `browsingContext.captureScreenshot {origin: "viewport"}` returns base64 PNG by default. It also takes `clip` and `imageSize`. | Confirmed |
| Popups | `Target.targetCreated` with `openerId` | `browsingContext.contextCreated`, whose `Info` carries `originalOpener`. Firefox had it by 129 ([bug 1902657](https://bugzilla.mozilla.org/show_bug.cgi?id=1902657)); the first version is not stated. | Confirmed (by 129) |
| Page closed | `Target.detachedFromTarget` | `browsingContext.contextDestroyed` | Confirmed |
| Close page | `Target.closeTarget` | `browsingContext.close` | Confirmed |
| JS dialogs | `Page.javascriptDialogOpening` and `Closed`, `Page.handleJavaScriptDialog` | `browsingContext.userPromptOpened {type, message, defaultValue, handler}`, `userPromptClosed`, `handleUserPrompt {accept, userText}`. Set `unhandledPromptBehavior: ignore` in `session.new` so prompts wait for the session. | Confirmed |
| Mouse, drag, wheel | `Input.dispatchMouseEvent` | `input.performActions` with a `pointer` source (`pointerType: "mouse"`) and a `wheel` source (`scroll {x, y, deltaX, deltaY}`) ([MDN](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi/Modules/input/performActions)). The long-standing `performActions` meta bug is still open ([1792089](https://bugzilla.mozilla.org/show_bug.cgi?id=1792089)). | Confirmed |
| Touch input | `Input.dispatchTouchEvent` | `pointerType: "touch"`. Firefox has accepted touch pointers since 104 ([bug 1543337](https://bugzilla.mozilla.org/show_bug.cgi?id=1543337)). Angle and tilt are still failing ([1913696](https://bugzilla.mozilla.org/show_bug.cgi?id=1913696)), which the lane does not use. Without touch emulation, whether pages get `touchstart` or only pointer events is unverified. | Confirmed (actions); event delivery unverified |
| Keys and shortcuts | `Input.dispatchKeyEvent` with modifier bitmasks | `key` source `keyDown` and `keyUp`, using WebDriver key codes (`\uE008` for Shift and so on). Modifiers are separate key actions in the same tick, which fits the lane's press-modifiers-first order. | Confirmed |
| Type text | `Input.insertText` | No equivalent. Either send one `keyDown`/`keyUp` per grapheme (the spec allows any single grapheme as a key value; IME and emoji behaviour in Firefox is unverified), or use `script.callFunction` with `document.execCommand("insertText")` on the focused element. | **Gap** (workaround exists) |
| Browser name | `Browser.getVersion` | `session.new` result `capabilities.browserName` and `browserVersion` | Confirmed |
| `restart-app` clear | `Storage.clearDataForOrigin {storageTypes: "all"}` | BiDi `storage` covers cookies only (`getCookies`, `setCookie`, `deleteCookies`). localStorage and sessionStorage access is still under discussion ([WG minutes 2025-06-11](https://www.w3.org/2025/06/11-webdriver-minutes.html), w3c/webdriver-bidi#921). Options: (a) a fresh `browser.createUserContext` per restart, which is clean but drops logins; (b) `deleteCookies` plus a page script that clears local and session storage and deletes IndexedDB databases, which misses caches and service workers. | **Gap** |
| Screen source | `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot` | **None.** See below. | **Gap (blocker)** |

## The accessibility tree gap

- BiDi has no accessibility-tree command. [w3c/webdriver-bidi#443](https://github.com/w3c/webdriver-bidi/issues/443), "Accessibility module in WebDriver BiDi?", is open with no PR. At the September 2024 WG discussion there was no agreement on what the tree should look like. Later work went to accessibility interop testing (wpt RFCs #204 and #226), not a tree dump. **Confirmed.**
- `browsingContext.locateNodes` accepts an `accessibility` locator `{role?, name?}`, which Firefox has had since 127 ([bug 1885577](https://bugzilla.mozilla.org/show_bug.cgi?id=1885577)). It *finds* nodes by computed role or name. It does not enumerate the tree or return names, and its `NodeRemoteValue` results carry no boxes ([MDN locateNodes](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi/Modules/browsingContext/locateNodes)). **Confirmed.**
- Puppeteer, the strongest evidence of BiDi coverage, lists its whole Accessibility API as unsupported over BiDi, along with `Page.emulate` ([pptr.dev/webdriver-bidi](https://pptr.dev/webdriver-bidi)). **Confirmed.**

Ways to fill it, all **unverified**:

1. **Page-script tree (recommended spike).** One `script.callFunction` walks the DOM, including open shadow roots and same-origin frames. For each element it returns tag, explicit `role`, `aria-*`, a text or label-based name, `data-testid`, `id` and `getBoundingClientRect()` in viewport CSS pixels. This is the same shape `WebAxSourceNode` already merges, and it costs one round trip. It is not the engine's computed tree: implicit roles and accessible names are approximations, closed shadow roots and cross-origin iframes are invisible, and it can disagree with what Chrome reports for the same page.
2. **Mix in engine roles.** Run `locateNodes {type: "accessibility", value: {role}}` once per role the Screen cares about (button, link, textbox, checkbox and so on) to replace the guessed roles with Firefox's computed ones. That is one round trip per role, and names are still guessed.
3. **Privileged chrome-scope script.** Start Firefox with the system-access flag; sources disagree on the name: `--remote-enable-system-access` per [bug 1944565](https://bugzilla.mozilla.org/show_bug.cgi?id=1944565) (138), `--remote-allow-system-access` per [newsletter 148](https://fxdx.dev/firefox-webdriver-newsletter-148/). Then use `getTree {"moz:scope": "chrome"}` and `script.callFunction` against `nsIAccessibilityService` for the real tree, with roles, names and bounds. This uses Gecko internals with no stability promise, and Mozilla's security docs warn that the flag grants unrestricted Gecko API access. Not recommended.

## Does it fit ADR-0005?

- **In substance, yes.** ADR-0005 removed a *WebDriver server* (Appium) sitting between Yoqa and the device. Firefox's BiDi endpoint is the browser itself, like CDP is for Chrome. There is no geckodriver, no Marionette and no extra process. Confirmed by the BiDi-only session path above.
- **In wording, no.** ADR-0005 says "the runner has no WebDriver client", and ADR-0007 says "Firefox, Safari and remote CDP endpoints are out of scope". A Firefox lane needs a new ADR that supersedes those lines and states the rule as: *Direct means talking to the browser's own built-in endpoint; a separate driver or server process is never Direct.* The Lane stays `direct`, with implementation `bidi` beside `cdp`.
- **Cost.** It means a second protocol client (BiDi command and event typing, `session.new`, subscriptions), a second fake (a `fake-bidi.ts` for the Lane contract suite), and per-browser branches in launch and discovery. The CDP client shares nothing at the wire level.

## Open questions, candidate tickets

1. **Page-script Screen source for BiDi.** Prototype the `script.callFunction` tree on the Expo demo in Firefox and diff it against Chrome's AX-tree Screen. Is the fidelity good enough for Cases written on Chrome to run on Firefox?
2. **ADR: is WebDriver BiDi "Direct"?** Amend ADR-0005 and ADR-0007 before any Firefox code.
3. **Hands-on launch check on macOS and Windows.** Firefox 145 or later with a kept `-profile` dir: read `WebDriverBiDiServer.json`, connect with Bun's `WebSocket` (check the `Origin` header), `session.new`, screenshot a background tab, confirm `-no-remote` and the profile lock, and check whether `remote.prefs.recommended` writes into the profile.
4. **Mobile presets on Firefox.** Track [bug 2006347](https://bugzilla.mozilla.org/show_bug.cgi?id=2006347) (`setTouchOverride`). Until it lands, should mobile presets be refused on Firefox, or run with a mobile UA and viewport but no touch detection?
5. **`restart-app` semantics without origin clear.** Choose between a fresh user context per restart and a script-based clear.
