# Session bar: one shared Active Session across Inspector and Runs

## Goal

Make the app's single top bar the one place to manage the **Active Session** (see `CONTEXT.md`), the Device Session the Inspector and Runs share. Connect once from any page; a Run adopts that session, and you can watch and cancel the Run from anywhere. Close the gaps around it: the Test cases page asked you to "connect in the top bar" without a Connect button, the WDA select rebuilt WebDriverAgent under the session a Run was about to adopt (and as a physical device even on simulators), and a Run for app B that adopted a session opened for app A read A's Screen. Issue #272.

## Plan summary

- **The runner already owns sharing** (ADR-0001 and its shared-session update): a Run adopts the Active Session (`heldByRun`) and leaves it live. This work finishes the desktop side and adds two runner pieces: the holder's Run id, and a target app that follows the Run or the selected app. No new ADR.
- **Target app per Lane:** each Lane gains `setTargetApp(appId)` that changes what it reads or relaunches without reconnecting or launching anything. The cabled-iPhone lane reads the Screen for that bundle, the simulator and Android Direct lanes relaunch it after backgrounding; the Appium lane ignores it (its app lives in its capabilities).
- **Who retargets:** the runner, when a Run adopts the session (to the Run's app), and a new `POST /devices/retarget`, which the desktop calls when you switch app in the sidebar while no Run holds the session. Refused (`409`) while a Run holds it: the Run decides what it reads.
- **Run connects first** through the bar's own connect path, so connect errors are toasts and never Runs in history.
- **WDA rebuild moves to Restart**, offered only for an iOS session on the Appium lane, with the device's real kind from the device list. A device the list does not have gets no rebuild item rather than a guessed kind.
- **Remembered device** in the webview's `localStorage` (like the selected app): only a device connected from this desktop, preselected at launch only when the device list still has it. It never connects.
- Rejected: a reconnect (or a prompt) on app switch; keeping the WDA select next to Run; auto-connecting the remembered device; a new ADR.

## What shipped

**Runner**
- `DeviceSession.setTargetApp` on every Lane (`ios-device-lane.ts`, `ios-direct-lane.ts`, `android-direct-lane.ts`; a no-op in `appium-lane.ts`).
- `acquireSessionForRun` retargets an adopted Active Session to the Run's app (bundle id on iOS, package on Android).
- `retargetActiveSession` + `POST /devices/retarget` (`{ bundleId?, appPackage? }`, `404` with no session, `409` while a Run holds it); client `retargetDevice`.
- `GET /devices/active` reports `heldByRunId` next to `heldByRun`.

**Desktop** (`apps/desktop/src/mainview/features/devices/`)
- `session-bar.tsx` / `session-toolbar.tsx`: Connect / Restart / Disconnect on every page. While connected, the device button shows the session's device by the name the device list gives it (`session-device.ts`), from any source (desktop, CLI, a Run), or by its id while the list does not have it. The pill reads "Live · Direct" / "Live · Appium" ("Connected · …" when the Lane has no live stream), with the Lane warning as its tooltip.
- The last device you connected from the desktop (Connect, Restart, or Run connecting first) and its platform are remembered across launches (`yoqa.lastDevice`) and preselected, never connected; a session the bar only adopted (from the CLI or a Run) is not remembered, and a device the list no longer has leaves "Select device".
- `run-controls.tsx`: with a picked device and no Active Session, Run connects first (the bar shows "Connecting…"), then creates the Run; a failed connect is a toast and no Run. Run is disabled for want of a device only when there is neither a session nor a picked device. The WDA Skip/Rebuild select is gone.
- Restart on an iOS Appium-lane session whose device is in the device list is a menu: "Restart session" or "Restart & rebuild WebDriverAgent" (`wda-setup.ts`: setup with `force`, then reconnect on the Appium lane). On a physical iPhone the forced setup rebuilds and reinstalls WDA, signed from Settings; on a simulator it drops Appium's WDA build (`~/.yoqa/wda-sim`, `services/runner/src/domains/ios/simulator-wda.ts`), so the reconnect compiles WDA from scratch.
- `session-run-chip.tsx`: while a Run holds the session, every page shows "Running · n/m · Cancel" (n = cases finished, whatever their outcome, as the runs list counts them; m = all cases), linked to the Run, for Runs started from the desktop, CLI or connector. Without a holder id it says "Run in progress", with no link.
- `use-retarget-on-app-switch.ts`: switching app in the sidebar while connected and unheld retargets the session; the Inspector marks its cached tree stale so the next selection reads the new app. When a Run for another app lets the session go, the session is pointed back at the selected app (`session-app.ts`); a Run for the selected app leaves it as is.

## How to verify

1. `bun run test` (runner: Lane retarget on the cabled-iPhone, simulator and Android Direct lanes; a Run for app B adopting a session for app A reads B's Screen / relaunches B; `heldByRunId`; `POST /devices/retarget` and the Screen after it. Desktop: device lookup, remembered device, pill label, Run chip, Run target, the app id per platform, pointing the session back at the selected app after a Run).
2. Desktop, Runs page: pick a device, **Connect** → pill "Live · Direct" (or Appium); hover it after a fallback to see the Lane warning. Restart and Disconnect work here and on Test cases.
3. `yoqa devices connect <udid>` from the CLI → the bar shows the device's name and the Lane.
4. Quit and relaunch the desktop app → the last device connected from the desktop is preselected, not connected (a device connected only from the CLI in step 3 is not). Delete that simulator (or unplug the iPhone) and relaunch → "Select device".
5. Test cases, select cases, no session, device picked → Run: the bar shows "Connecting…", then the Run starts. With a device that can't connect → a toast and no new Run in Runs.
6. iOS session on the Appium lane (`yoqa devices connect <udid> --lane appium`) → Restart offers "Restart & rebuild WebDriverAgent" on a simulator and on a cabled iPhone.
7. Start a Run (desktop or `yoqa runs create`) → every page shows "Running · n/m · Cancel"; the label opens the Run, Cancel cancels it.
8. Connected, no Run: switch app in the sidebar → no reconnect; Inspector → select an element: the tree reads the new app (on a cabled iPhone the new app must be in front, or the read says it is backgrounded).
9. Connected with app A selected, start a Run for app B from the CLI (`yoqa runs create`); when it finishes, the Inspector reads app A again, with no reconnect.

## Follow-ups

- The session bar's UI states (remembered device, Run chip, connect-first) are covered by unit tests of their pure helpers, not by rendered component tests.
