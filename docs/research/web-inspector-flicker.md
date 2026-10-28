# Research: what makes the browser flicker while the web Inspector is open

Ticket [#344](https://github.com/Aris-ngoy/qa-agent/issues/344), under map [#339](https://github.com/Aris-ngoy/qa-agent/issues/339). Code: `services/runner/src/domains/devices/web-direct-lane.ts` (`attachPage`, `captureFrame`, `pageSource`) and `apps/desktop/src/mainview/features/inspector/hooks/use-inspector-feed.ts` (the poll timers). Vocabulary: **Browser device**, **Viewport preset**, **Frame Feed** in [`CONTEXT.md`](../../CONTEXT.md).

**Status markers:** **[measured]** means observed on this Mac on 2026-10-28 with the harness in [`scripts/web-inspector-flicker.ts`](./scripts/web-inspector-flicker.ts). **[unverified]** means not checked here.

## Answer in short

- **The cause is `Page.captureScreenshot` while `Emulation.setDeviceMetricsOverride` is on.** Every capture repaints the browser window at other sizes and then back. This happens 4 times a second, because a web device has no MJPEG stream, so the Inspector polls `/screenshot/image` every 250 ms. **[measured]**
  - With emulation off, the same poll paints no odd frames.
  - The other suspects paint none either: `Page.bringToFront`, re-applying emulation, the tree poll (`Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`, even at 250 ms), and the poll cadence on its own.
- **Why** (Chromium `content/browser/devtools/protocol/page_handler.cc`, `PageHandler::CaptureScreenshot`): when device emulation is on, the capture does three things.
  1. It re-emulates with `scale = emulated DPR ÷ host DPR`.
  2. It resizes the view to the emulated size.
  3. When the image is back, it restores both.
  The screen sees each of these steps. The source is from memory of Chromium; the frames below confirm the behaviour **[measured]**.
- **What the user sees.** At the mobile preset, the window normally shows the 390-px page at its top-left corner. During a capture it shows something else **[measured]**:
  - the page blown up 1.5× (DPR 3 emulated over the Mac's DPR 2),
  - torn, half-resized frames,
  - at least once, the page laid out across the full 1200-px window.
- **Frame rate.** Today's feed reaches **4 fps**. A PNG capture takes 75–170 ms, and polling back to back reaches only 7–12 fps. `Page.startScreencast` delivers up to ~120 frames/s on an animating page and paints no odd frames. **[measured]**
- **JPEG does not avoid it.** A JPEG capture is ~30 % faster but goes through the same emulation path, and flickers the same. So does a `clip`, and so does a DPR matched to the host. **[measured]**
- **Recommendation:** replace the screenshot poll with a `Page.startScreencast` Frame Feed while the Inspector is open. Keep `captureScreenshot` for one-off shots (Run screenshots, `yoqa screenshot`), where one flash is acceptable. Fitting the browser window to the preset does not work (below).
- **Dia:** not measured. A fresh Dia profile exposes no page target. It sits behind the sign-up wall from [#343](https://github.com/Aris-ngoy/qa-agent/issues/343), and a tab created over CDP never paints, so `captureScreenshot` hangs (30 s timeout). It needs the kept, signed-in profile from [#352](https://github.com/Aris-ngoy/qa-agent/issues/352) first. **[measured]**

## Setup

- **Machine:** this Mac, macOS 27.2, Retina display (host DPR 2). The browser window's view was 1200×687 CSS px.
- **Browsers:**
  - **Chrome for Testing 133.0.6943.141** (the puppeteer cache; Google Chrome is not installed here), headful, with the lane's `LAUNCH_FLAGS` on a temp profile.
  - **Dia 1.54.2** (Chromium 156.0.8078.48).
- **Harness:** it attaches as `attachPage` does: `Page.enable`, `setDeviceMetricsOverride` at the preset, touch at mobile, then `bringToFront`. Then it runs one variant at a time for 5–8 s against a probe page, which has a spinning box and a long paragraph. Two observers:
  1. **The page.** It counts animation frames (fps and gaps > 50 ms), and logs `resize`, `visualViewport` resize, `devicePixelRatio`, focus and visibility events.
  2. **The compositor.** A `Page.startScreencast` runs alongside, and the harness records the size and metadata of every frame painted. Screen Recording is not granted to the shell here, so the window itself could not be captured. The screencast shows the same view the window does.

## What the page sees

Nothing. In every variant on Chrome there were zero `resize`, `visualViewport`, DPR, focus or visibility events. The flicker happens outside the page, which is why page-side debugging never finds it. **[measured]**

Animation smoothness (Chrome, 8 s per variant; page fps / gaps > 50 ms):

| Variant | Mobile preset | Desktop preset |
|---|---|---|
| Idle (emulated, no poll) | 60.1 / 0 | 60.1 / 0 |
| **Today: PNG every 250 ms + tree every 8 s** | **56.4 / 9** (max 66 ms) | 60.0 / 0 |
| PNG poll, no emulation | 60.0 / 0 | 60.0 / 0 |
| PNG poll, DPR matched to host (2) | 60.0 / 0 | 55.9 / 11 |
| JPEG poll | 59.9 / 0 | 60.0 / 0 |
| Screencast only | 60.0 / 0 | 60.1 / 0 |
| Tree poll only, every 250 ms | 60.0 / 0 | 59.9 / 0 |
| `bringToFront` every 250 ms | 60.0 / 0 | 60.0 / 0 |
| Re-emulate every 250 ms | 60.0 / 0 | 59.9 / 0 |

On its own, the page's frame rate is a weak signal of the flicker. The compositor frames below are the real evidence.

## What the compositor paints

Frames painted in 5 s, grouped by `image size · device size` from the screencast metadata. The steady frame is `2400×1374 · 1200×687`: the window's view at DPR 2. Any other size means the window flashed. **[measured]**

| Variant (Chrome) | Mobile preset: odd frames / all | Desktop preset: odd frames / all |
|---|---|---|
| Emulated, no poll | 0 / 297 | 0 / 296 |
| **PNG poll (today)** | **40 / 188**: 38 at `1170×2532 · 585×1266` (390×844 × 1.5), 2 torn | **41 / 231**: `1280×800 · 640×400` (1280×800 × 0.5), `2198×1374`, torn `1280×733` |
| JPEG poll | 53 / 271 | 43 / 272 |
| PNG with `clip` | 46 / 179 | 58 / 255 |
| PNG, DPR matched to host | 54 / 235 (`780×1688 · 390×844`, torn `780×447`) | 63 / 160 (`2560×1600 · 1280×800`, torn `2560×1466`) |
| **PNG poll, no emulation** | **0 / 239** | **0 / 246** |
| Tree poll every 250 ms | 0 / 87 | 0 / 300 |
| `bringToFront` every 250 ms | 0 / 296 | 0 / 297 |
| Re-emulate every 250 ms | no oscillation: every frame `780×1688 · 390×844` | no oscillation: every frame `2560×1600 · 1280×800` |
| PNG, window resized to fit the preset | odd frames remain: the view stops at 500×731 | odd frames remain: the view stops at 1280×731 |

About one painted frame in five is an odd one while the Inspector is open. Matching DPR removes the 1.5× rescale, but the view resize remains. Only turning emulation off removes the odd frames, and a web device needs emulation for its Viewport preset. So the fix is to capture some other way, not to tune the screenshot.

## Capture speed

Chrome, median ms per capture, and the best rate with no wait between captures **[measured]**:

| | Mobile preset | Desktop preset |
|---|---|---|
| PNG `captureScreenshot` | 150–170 ms (6.8 fps back to back) | 85–110 ms (12.4 fps back to back) |
| JPEG q80 `captureScreenshot` | 86–116 ms | 57–75 ms |
| `Page.startScreencast` (JPEG q80, every frame) | 119.8 frames/s | 119.6 frames/s |
| Tree read (`getFullAXTree` + `captureSnapshot`) | 3–23 ms on the probe page | 4–38 ms |

With the 250 ms timer and the feed's in-flight guard, today's feed is 4 fps at both presets.

## Recommendation

- **The Frame Feed for web becomes a screencast.**
  - Start `Page.startScreencast` (JPEG, with `maxWidth`/`maxHeight` at the preset's size and `everyNthFrame` tuned) when the Inspector attaches. Ack each frame, and stop on detach.
  - The runner can serve these frames on `/stream.mjpeg`, just as iOS and Android do today. The desktop app then takes its existing MJPEG path, and the 250 ms PNG poll stops for web.
  - Keep `captureScreenshot` for single shots.
- **Check first** **[unverified]**: what a screencast frame covers under emulation. Idle frames here came back at the full view size (2400×1374) with the 390-px page at the top-left. Once emulation had been re-applied, they came back at the emulated size (780×1688). The feed must crop or size them to the preset, so the Inspector's 0–1000 coordinates still match. Read `metadata.deviceWidth/Height` and `offsetTop` per frame.
- **Rejected:**
  - JPEG or `clip` screenshots: same flicker.
  - DPR matched to the host: the view resize still flickers, and the mobile preset needs DPR 3.
  - Resizing the window to the preset: macOS keeps a minimum view, and 844 px rarely fits.
  - Polling less often: fewer flashes, but a worse feed.
- The tree poll, `bringToFront` and re-applying emulation need no change.

## How to reproduce

```bash
bun docs/research/scripts/web-inspector-flicker.ts chrome mobile current png-only no-emulation observe-png observe-png-no-emulation
```

Arguments: `chrome|dia`, `mobile|desktop`, then variant names (all of them if none). `RUN_MS` sets the time per variant, and `SAVE_FRAME=1` saves one JPEG per frame size. The Chrome path points at the puppeteer cache. Edit `BROWSERS` for another install.

## Follow-ups

- **Dia and Arc:** repeat both tables on a kept, signed-in profile, once [#352](https://github.com/Aris-ngoy/qa-agent/issues/352) has one.
- **A real Google Chrome** (stable 156 is current) is not installed here. The emulation path in `CaptureScreenshot` is old, so the result should hold, but it is not measured.
- **The screencast frame geometry under emulation** (above) needs a spike before the Frame Feed ticket.
