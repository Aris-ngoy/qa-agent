# Inspector Session on a cabled iPhone

## Goal

The UI inspector's screenshot poll was ending the Device Session. `GET /screen` came back 410 `Device session ended` because usbmuxd briefly did not list the iPhone, and that same link is what gestures use. A frame or a tree read should be able to miss the phone without disconnecting the top bar.

## Plan summary

- **Two links, one runner.** `device-ios` still starts one `YoqaRunner`. Gestures, recording and the startup `status` use the control link. Screenshot, snapshot and viewport use the Inspector Session, a second link to the same port.
- **A miss on the Inspector Session stays there.** It answers 503 `Device unreachable` and does not call `onSessionDead`, including after the grace window. The inspector keeps the last frame and shows **Waiting for device**. The top bar stays connected. Frames resume when the phone answers again.
- **A miss on a gesture still ends the Device Session** once the cable has been unreachable past the grace window, and so does the runner process exiting.
- **One inspector tunnel at a time.** A frame and a tree read queue on that link, so they do not open two usbmuxd connections together. A gesture can still run alongside a read.
- Rejected: a second Device Session or a second `YoqaRunner` (XCUITest allows one runner on the phone), and treating every usbmux miss as fatal again.

## What shipped

- `ios-device-lane.ts`: `controlLink` and `inspectorLink`. `captureFrame`, `pageSource` and `getWindowSize` go through the inspector link. Gestures stay on `call`.
- The desktop already treats 503 as waiting and 410 as the session ending, so the feed did not need a new branch.
- Glossary: **Inspector Session** in `CONTEXT.md`.

## How to verify

`bun test services/runner/src/domains/devices/ios-device-lane.test.ts`

On a cabled iPhone: connect from the top bar and open **Inspector**. The feed starts on its own. Unplug the phone. The badge reads **Waiting for device** and the top bar stays connected. Plug it back in and frames resume. With it unplugged past the grace window, a gesture (not the frame poll) is what ends the session.

## Follow-ups

The Appium lane and the other Direct lanes still share one path for reads and gestures. Only `device-ios` has an Inspector Session.

The phone captures half-size JPEGs in the background, about 12 a second, and the runner serves the newest one as MJPEG. The inspector shows that as **Stream** and the picture follows the phone. A full PNG poll is only the fallback when this runner has no recorder.

A 410 for `GET /screen` is cacheable. The webview was replaying one from when usbmuxd had missed the phone, with no runner pid and no `chain`, while the phone was already listed again. Live reads now use `cache: "no-store"` and a fresh query, and the inspector ignores that unattributed 410 instead of ending the session.
