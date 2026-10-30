# Web: the Everyday browser, by consent, in Yoqa's own window

## Goal

Let a user test in their real session: the account, extensions and state their own browser already has. Yoqa connects to the user's running Chromium browser on its default profile through the consent toggle at `chrome://inspect/#remote-debugging`, and drives a page in a window of its own ([#370](https://github.com/Aris-ngoy/qa-agent/issues/370), the tracer bullet of [ADR-0009](../adr/0009-everyday-browser-consent-attach.md), under [#339](https://github.com/Aris-ngoy/qa-agent/issues/339)). The Kept profile ([web-kept-profile.md](./web-kept-profile.md)) stays the default way in. Vocabulary: **Everyday browser**, **Browser device**, **Device Session**, **Viewport preset**, **Frame Feed** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **One device per installed browser**: `web-chrome-everyday`, `web-edge-everyday`, `web-brave-everyday`, `web-chromium-everyday` and `web-dia-everyday`, next to the launched `web-chrome` etc. Dia is listed here though Yoqa does not launch it yet, since the consent path is confirmed on it (#355).
- **Discovery reads the port file and probes HTTP, never a socket.** Each browser's default user-data folder on macOS (`~/Library/Application Support/Google/Chrome/`, `…/Microsoft Edge/`, `…/BraveSoftware/Brave-Browser/`, `…/Chromium/`, and Dia's `…/Dia/User Data/`) holds `DevToolsActivePort` while the toggle is on. A device is `ready` when the file names a port where a plain `GET /json/version` gets any HTTP answer (the toggle answers 404); otherwise `remote debugging off`. A stale file, which Dia leaves behind, names a port nothing answers on. Opening a WebSocket would raise the Allow prompt, so discovery never does.
- **One socket per connect.** The connect opens `ws://127.0.0.1:<port><path>` from the file once and waits up to 60 s for the user's Allow. It is never retried, since each attempt prompts again. A socket that fails or closes before it opens is `Remote debugging was denied in <Browser>`; no answer in time is `<Browser> did not answer the Allow prompt within 60 s`. The request's abort signal cancels the wait: a client that hangs up on `POST /devices/connect` ends it.
- **The resolve step is the only difference.** After the socket opens, the session is the web Direct lane's, as for attach by port and a launched browser: Viewport preset, Screen, Actions, the screencast Frame Feed, popups.
- **Yoqa's own window.** The session's page is `Target.createTarget { url: "about:blank", newWindow: true }`, with no `browserContextId`. It never lists or attaches to the user's targets, so the Screen, screenshots and the Stream only ever come from that page or a popup it opens. terminate-app's blank page also opens in a new window.
- **Disconnect closes only Yoqa's pages** (its page, and any popup chain it followed), then the socket. The browser, the user's tabs and the toggle stay as they were. The user closing Yoqa's window is a Dead Session, as on any web device.
- **The profile name** the window opened in is read from the browser's `Local State`: `profile.info_cache[profile.last_used].name`, `Default` when none was last used, or null when the file cannot be read. It is on the connect answer as `browserProfileName`.
- Rejected: probing with a WebSocket in discovery (prompts on every list), retrying a failed connect (prompts again), and attaching to the user's front tab (ADR-0009).

## What shipped

- `chromium-everyday.ts`: `findEverydayBrowsers`, `listEverydayDevices` (`ready` / `remote debugging off`; booted-only listing leaves out the off ones), `openEverydaySocket` (one attempt, `ALLOW_TIMEOUT_MS` = 60 s, injectable, cancellable, `EverydayConnectError` with the Deny, timeout and cancelled messages), and `readEverydayProfileName`.
- `cdp-client.ts`: `connectCdp` takes a `signal`, treats a close before open like an error, and fails with `CdpOpenError` (`refused`, `timeout`, `aborted`) so the Everyday connect can word each one. `Target.createTarget` takes `newWindow`.
- `web-direct-lane.ts`: `openBrowser` resolves and connects all three ways in; an Everyday browser gets its own window, `browser` is its name with the version it reports (`Google Chrome 144.0…`), `browserProfileName` is set, and `quit` closes Yoqa's targets before the socket. `webDirectDeps` takes `everydayBrowsers` and `allowTimeoutMs` for tests.
- `SessionOptions.signal`, passed from `POST /devices/connect` (`c.req.raw.signal`) through `connectDevice`. `browserProfileName` on `DeviceSession`, `ActiveSessionInfo` and `activeDeviceResponseSchema`.
- `GET /devices?platform=web` (and `yoqa devices web`) lists the Everyday browsers after the launched ones.
- Fake CDP: `consent` mode (`/json/*` is 404, each socket waits for `allow()` / `deny()`), with `socketRequests()`, `createdTargets` and `attachedTargets`. The Lane contract suite gains `webEverydayLane`, an Everyday Chrome with a tab of the user's own.

## How to verify

```bash
cd services/runner
bun test src/domains/devices/chromium-everyday.test.ts src/domains/devices/web-direct-lane.test.ts src/domains/devices/active-session.test.ts src/domains/devices/lane-contract.test.ts
```

By hand on a Mac with Chrome 144+ or Dia, with the runner up and the toggle on at `chrome://inspect/#remote-debugging`:

```bash
yoqa devices web                       # web-chrome-everyday … ready
curl -s localhost:<port>/devices/connect -H 'content-type: application/json' \
  -d '{"deviceId":"web-chrome-everyday","platform":"web"}'   # click Allow in Chrome
yoqa action open-url --url https://example.com
yoqa action tap --label "More information..."
yoqa screenshot /tmp/page.png          # Yoqa's page only, never your tabs
yoqa devices disconnect                # Yoqa's window closes; Chrome and your tabs stay
```

Click Deny instead, or wait 60 s, and the connect fails with its own message. Turning the toggle off lists the device as `remote debugging off`.

**Which profile does a `createTarget` with no `browserContextId` open in, with two profiles open?** Not checked by hand yet: this slice was built on Linux against the faked browser. Expected, from Chromium's code, is the profile of the browser's last active window; `browserProfileName` reports `Local State`'s `last_used`, which is the same profile in the common case. Record the answer here after checking on a Mac with two Chrome or Dia profiles open.

## Follow-ups

- The hand check above, and the profile question, on Dia or Chrome 144+.
- Limits and the per-App first-use warning: no storage wipe on restart-app, `profile: clean` an error, Runs use it only when named ([#371](https://github.com/Aris-ngoy/qa-agent/issues/371)).
- Desktop: the picker, "Click Allow in <Browser>" while waiting, and cancel ([#372](https://github.com/Aris-ngoy/qa-agent/issues/372)).
- CLI: connect with the warning and `--yes`, attach by port as CLI/CI only ([#373](https://github.com/Aris-ngoy/qa-agent/issues/373)).
- Windows paths ([#354](https://github.com/Aris-ngoy/qa-agent/issues/354)) and picking a profile other than the default context are not decided.
