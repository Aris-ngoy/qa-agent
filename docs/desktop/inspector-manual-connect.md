# Inspector: manual connect, flicker-free frames, React Compiler + Legend State

## Goal

- The Inspector should not attach to the Active Session on its own. Opening the page with a session already up started the stream or the 250 ms screenshot poll right away. When the device dropped (usbmuxd gap), the poll kept hitting a dead session and logged `Screenshot poll: session gone, but the runner still lists it` on every tick.
- Remove the screen flicker: each poll tick and every MJPEG remount swapped the `<img>` src, so the box went blank until the new frame decoded.
- Install the React Compiler and Legend State so the Inspector re-renders less.

## Plan summary

- **Manual attach.** The top bar still owns the Device Session ([Session bar](./session-bar.md)). The Inspector attaches to it only when the user clicks **Connect** and stops its feed on **Disconnect**. Neither one touches the device session. The Inspector still detaches by itself when its session goes away (disconnect, restart, another device, or leaving the page). It never re-attaches by itself.
- **Unreachable Session.** While the runner waits out its grace window for a device that stopped answering, it answers 503 `Device unreachable`. The Inspector keeps the last frame, shows **Waiting for device**, logs once, and drops the poll to about one try per second. The runner alone decides when the session is dead: its 410 ends the Inspector at once, with no desktop timer and no re-check (see [the session note](../sessions/2026-10-11-runner-tunnel-retry.md)).
- **Double-buffered frames.** Each new frame loads into a hidden `<img>` behind the one on screen and swaps in on `load`. Streams get a 1.5 s fallback because a multipart body may never fire `load`. The old slot then unmounts, which also closes the old MJPEG connection.
- **Legend State for the feed.** Frame URL, feed mode, element tree, selection and the Inspect/Interact toggle now live in one observable. Only `LiveFrame` subscribes to the frame URL, so a poll tick re-renders that one component instead of the whole page and script panel. Code outside render reads values with `.peek()`, which replaces the old `useRef` mirrors kept in sync by effects.
- **`useValue`, never `use$`.** The two are the same Legend hook, but the React Compiler recognises hooks by the `use` + capital-letter name pattern. It treats `use$` as a plain call and caches it in a conditional block, so the hook is skipped on re-render and React throws "Should have a queue" (seen on the first build of this change).
- **React Compiler.** `babel-plugin-react-compiler@1.0.0` runs through `@vitejs/plugin-react`. Compiler 1.0 skips any component with `try/finally`, or with conditionals inside a `try`. The Inspector's async request code therefore lives in a plain class (`InspectorFeedController`). The page's own handlers use a small `settle()` helper and promise callbacks instead of `try`.
- Rejected: auto-attaching again after a stall (the user asked for manual), and persisting the attach choice across visits.

## What shipped

- `apps/desktop/src/mainview/features/inspector/inspector-feed.ts`: `InspectorFeedController` with the `feed$` observable. It handles connect/disconnect/clear, tree refresh, poll ticks, Unreachable Session handling and MJPEG remount.
- `live-frame.tsx` (+ `live-frame.test.ts`): double-buffered frame (`nextSlots` / `promoteSlot`).
- `screenshot-panel.tsx`: reads the feed with `useValue`. It adds **Connect** / **Disconnect** in the header, a **Connect Inspector** empty state ("No device session" when the top bar has none), and the **Waiting for device** badge.
- `inspector-page.tsx`: auto-adopt effect removed. Feed logic moved to the controller. No `try` blocks in the component, so the compiler now optimizes it.
- `vite.config.ts`: compiler plugin. `package.json`: `@legendapp/state@3.0.0-beta.48` (v3 is the line with the `useValue` hooks; pinned exact because it is a beta) and `babel-plugin-react-compiler@1.0.0`.
- `test-cases/detail-page.tsx`: `useReducedMotion()` moved above the early return. The compiler flagged it as a Rules of Hooks violation, and it crashed the page when a case gained its first script.

## How to verify

1. Connect a device from the top bar, then open **Inspector**. It shows "Inspector not connected" and makes no `/screenshot` or `/stream.mjpeg` requests.
2. Click **Connect**. The stream (or poll) starts. With the poll feed, frames update without blinking. Click an element: under Stream the tree refresh remounts the stream without a blank frame.
3. Click **Disconnect**. The feed stops and the top bar still shows the session as connected.
4. Unplug the iPhone briefly. The badge reads **Waiting for device** and the terminal logs one `Device unreachable` line, not one per tick. Plug it back in within 20 s and frames resume. Leave it unplugged and the runner ends the session: the Inspector detaches with "Device session ended".
5. Restart or disconnect from the top bar while attached. The Inspector detaches and waits for **Connect**.
6. Compiler coverage: build with the plugin's `logger` (or run it over `src/mainview`). `InspectorPage` compiles with no `CompileError`.

## Follow-ups

- The compiler still skips components with `try/finally` in `session-bar.tsx`, `runs/detail-page.tsx`, `settings/providers/*`, `splash/boot-gate.tsx` and `test-cases/detail-page.tsx`. They work as before, just without the optimization. Apply the same `settle()` / controller treatment if they turn out to be hot.
- Move to stable `@legendapp/state` v3 once it is released.
