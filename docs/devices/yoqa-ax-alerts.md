# yoqa-ax alerts (`device-ax`)

## Goal

Ticket [#244](https://github.com/Aris-ngoy/qa-agent/issues/244) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ax`](../plans/device-lanes/device-ax.md) third slice):

- `yoqa-ax`'s `alert` returns the title and buttons of a SpringBoard dialog, or empty.
- The Screen includes the dialog.
- Accept and dismiss on the opted-in iOS-simulator Direct lane go through `alert`, with no Appium and no idb.

The tree read it builds on is in [yoqa-ax-describe.md](./yoqa-ax-describe.md).

## Plan summary

- **How a dialog is recognised.** On Maps' location prompt, every element of the dialog has `1024` among its AXRuntime `containerTypes`. Their ancestor of `containerType` 1024 is labelled with the dialog's title. Settings (256) and the home screen (256) have none, and neither does SpringBoard's status bar (512). `yoqa-ax` marks those elements `inDialog`:
  - the title is the dialog's first text that isn't a button;
  - the buttons are its labelled buttons, in order, with frames in 0.0–1.0.
- **SpringBoard only.** `alert` reads SpringBoard's elements alone. A permission prompt is SpringBoard's, even over another app, so this costs about 5 ms warm, and no dialog answers `{"buttons":[]}` just as fast.
- **The Screen already has it.** `describe` reads SpringBoard after the foreground apps, so the dialog's title, message and buttons are in the Screen. While SpringBoard is frontmost (a dialog, the home screen), AXRuntime also lists it among the current applications, so `describe` read it twice. It now skips system applications there and reads SpringBoard once. That also removes the doubled status bar on Settings.
- **Accept and dismiss.**
  - The Lane asks `alert`, then picks the button by the label list's priority, not by the dialog's order:
    - accept: `Allow While Using App`, `Allow Once`, `Allow`, `OK`;
    - dismiss: `Don't Allow` and its curly-quote form.

    On Maps' prompt, accept now taps "Allow While Using App" even though "Allow Once" is listed first. The idb path used to take the first match in screen order and got a one-time grant. It now follows the same priority.
  - With no SpringBoard dialog, or no matching button, the button comes from the Screen. An in-app `UIAlertController`'s "OK" is still accepted that way.
  - The tap goes through `yoqa-sim`.
  - With nothing to tap, it throws `No accept alert button on screen` after the two reads.
- **One fallback for every `yoqa-ax` read.** A failed `alert` stops `yoqa-ax` the way a failed `describe` does. The tree and alerts then come from idb_companion for the rest of the session, with a Lane warning. One helper now serves both reads.
- Rejected:
  - recognising a dialog by its shape (a text above stacked buttons), which home-screen icons and sheets can match;
  - reading `alert` on every Screen read to add an idb-style `modal` entry, which costs a second round trip for what `describe` already returns.

## What shipped

- `native/yoqa-ax/`
  - `Tree.swift`: `Alert` (built from `inDialog` elements), `RawElement.inDialog`, and a shared `Rect.fraction(of:)`.
  - `Handler`: `alert`.
  - `AXRuntimeReader`: `alert()`, the `containerTypes` check, and SpringBoard read once.
  - Tests (23): dialog title and buttons, no dialog, the `alert` reply, and the host-built binary answering an empty `alert`.
- `services/runner/src/domains/devices/`
  - `yoqa-ax.ts`: `YoqaAx.alert()` and `YoqaAxAlert`.
  - `ios-direct-lane.ts`:
    - `viaYoqaAx`: one fallback for both reads.
    - `resolveAlert`: `alert` first, then the Screen, picked by `preferredButton` in label-list order, and tapped through `yoqa-sim`.
  - Tests:
    - `yoqa-ax.test.ts` (+1);
    - `ios-yoqa-sim-lane.test.ts` (+5):
      - accept takes the preferred button;
      - dismiss;
      - no dialog;
      - an in-app alert accepted from the Screen;
      - a failed `alert` falling back loudly.
    - the contract harness's `yoqa-ax` answers `alert`.

## Measurements

iPhone 17 Pro simulator (iOS 26.5), Xcode 27, Maps' location prompt:

- `alert` at the socket: 49 ms first, about 5 ms warm, 3 buttons.
- `describe` with the prompt up: 5 nodes, no longer doubled.
- Through the Lane (idb stubbed):
  - the Screen listed the title, message and the three buttons;
  - `dismissAlert` took 24 ms and `acceptAlert` 26 ms, and both closed the prompt (measured before the label-priority fix, when accept tapped "Allow Once");
  - with no dialog, `acceptAlert` failed in 7–9 ms;
  - no Lane warning, and no idb call besides the connect-time `describe`.

## How to verify

1. `cd native/yoqa-ax && xcrun swift test`, then build for the simulator (see [yoqa-ax-connect.md](./yoqa-ax-connect.md)).
2. `bun test ./services/runner/src/domains/devices/{yoqa-ax,ios-yoqa-sim-lane,lane-contract}.test.ts`
3. Live:
   - Run `xcrun simctl privacy <udid> reset location com.apple.Maps`, then launch Maps.
   - On a `YOQA_DIRECT_IOS_SIMULATOR=device-sim` session, the Screen shows the prompt's buttons, and accept or dismiss closes it.

## Follow-ups

- Only Maps' location prompt was checked live. Other SpringBoard dialogs (notifications, tracking, "Open in …") should show the same container type. Check them before #245 promotes `yoqa-ax`.
- In-app `UIAlertController`s are the app's own elements, not SpringBoard's, and stay out of `alert`. Accept and dismiss find them through the Screen.
- A dialog with a message but no title reports the message as its title. Only accept and dismiss read `alert` today, and they don't use the title.
