---
status: accepted
---

# Attach to the everyday browser by consent

[ADR-0007](./0007-web-direct-lane-over-cdp.md) rejected attaching to a user's everyday browser. Chrome 136 and later refuse `--remote-debugging-port` on the default profile, and the agent would act in the user's signed-in session. Its only attach path was by port, on a profile the user started with a non-default `--user-data-dir`. The Kept profile (#346) now covers "never sign in twice" for a browser Yoqa launches. Some users still want Yoqa in their real session: the account, extensions and state they already have.

Chrome 144 and later, and Edge, have a consent toggle at `chrome://inspect/#remote-debugging`. With it on, the browser listens on its **default** profile, writes `DevToolsActivePort` in its default user-data folder, and answers only the browser WebSocket (`/json/*` is 404). Each new connection waits until the user clicks **Allow** in the browser (#340). Dia has the same toggle and prompt (#355). Brave is reported working, and the other forks are unverified.

We add the **Everyday browser** as an opt-in second way in to a Browser device, through that toggle. The Kept profile stays the default.

- **Consent on every connect.** The user turns the toggle on themselves; Yoqa never writes the pref. Each connect is one WebSocket attempt that waits up to 60 s for the user's Allow. The user can cancel it, and it is never retried, since each retry prompts again. A Deny and a timeout each fail the connect with their own error.
- **Yoqa's own window only.** Yoqa opens a page in a new window of its own and drives only that page. It never reads, lists or drives the user's tabs. Disconnect closes Yoqa's window and the socket, and leaves the browser and the toggle as they were.
- **Never launched, quit or relaunched.** Yoqa does not launch, quit, relaunch or reconfigure the everyday browser. Relaunching it with `--remote-debugging-port` is rejected: Dia accepts the flag on the default profile and never prompts (#355), so any local process would get the signed-in browser without consent.
- **Limits.** There is no storage wipe there (a restart reloads the page instead of clearing the origin), and `profile: clean` is an error. A Run uses the Everyday browser only when it names that device.
- **Attach by port is CLI/CI only.** `chromium-cdp-<port>` stays for a browser started with a debug port on a non-default profile, from the CLI and CI. It leaves the desktop picker. Both paths end at a browser WebSocket and share one session setup.

This supersedes two parts of ADR-0007: the "attaching to a user's everyday browser" part of *Attach only*, and the *Attach by port* bullet. Everything else in ADR-0007 still holds: one Direct lane over our own CDP client, a browser as a device, and the session rules.

## Considered options

- **Relaunch the everyday browser with `--remote-debugging-port`:** rejected. Chrome refuses it on the default profile, and Dia accepts it with no prompt, which bypasses consent. It would also mean Yoqa quitting the user's browser.
- **A `chrome.debugger` extension:** deferred (#340). It covers screenshots, the accessibility tree, DOM snapshots, input and emulation, but `Target` is limited to auto-attach on tabs and `Browser` is unavailable, so tab and popup handling would be rebuilt on `chrome.tabs`. It also needs a Web Store listing and a native-messaging host per browser, an install warning to read and change all data on all websites, and a debugging infobar that stays up.
- **Copying the user's profile into a Yoqa-owned one:** rejected (#340). On Windows, App-Bound Encryption works only with the default user-data folder, so a copy loses its cookies. On macOS a copy decrypts but is a stale snapshot. On both it is the infostealer pattern Chrome's hardening targets.
- **No everyday browser at all:** rejected. The Kept profile covers most needs, but "test in my real session" is a real request, and the toggle gives a consented way to it.

## Consequences

- A Browser device has three ways in: launched on a Kept profile (the default), the Everyday browser, and attach by port (CLI/CI).
- The agent can act in the user's signed-in session. The first connect per App warns about it (a desktop dialog, or `--yes` on the CLI), and the choice is remembered per App.
- A connect can wait up to 60 s on a person, so the desktop and the CLI must say "Click Allow in <Browser>" while it waits, and let the user cancel.
- A stale `DevToolsActivePort` can point at nothing (#355), so a browser is listed as ready only when its port answers.
- Picking a profile other than the browser's default context, and Windows paths (#354), are not decided here.
