# Windows window controls

## Goal

Give the Windows desktop app minimize, maximize and close buttons. The main window uses `titleBarStyle: "hiddenInset"` so the app canvas paints under macOS's traffic lights. Electrobun has no inset native controls on Windows, so the window there had no caption buttons at all.

## Plan summary

- Keep the frameless canvas on every platform and draw Windows-style caption buttons in the webview. They are wired to electrobun's `BrowserWindow` API over the desktop RPC.
- Detect Windows from the WebView2 user agent, so no platform RPC is needed before the first paint.
- Rejected: `titleBarStyle: "default"` on Windows. It is a smaller change, but it adds a plain OS title strip above the canvas and breaks the look shared with macOS.

## What shipped

- **RPC** (`src/shared/rpc.ts`, `src/bun/index.ts`): `minimizeWindow`, `toggleMaximizeWindow`, `closeWindow` and `getWindowState`. `closeWindow` calls `mainWindow.close()`, so the existing `close` handler still stops the runner sidecar.
- **Webview** (`features/window-controls/`): `needsCustomWindowControls()` checks the user agent (with tests). `useWindowMaximized()` re-reads the maximized state on every resize, so Snap and double-click keep the Maximize / Restore glyph right. `WindowControls` is three 46×32 buttons pinned top-right, outside the drag region. Close turns `bg-error` on hover; the others use `on-surface/10`.
- `WindowControls` mounts in `main.tsx` next to `BootGate`, so it shows on the splash screen and in the app shell. It renders nothing on macOS and Linux.

## How to verify

- `bun test ./apps/desktop/src/mainview/features/window-controls`
- On Windows: `bun dev`. The splash screen and the app both show the three buttons top-right. Minimize hides the window, Maximize toggles to Restore and back (also after Win+Up or a double-click on the drag area), and Close quits the app and its runner.
- On macOS nothing changes: the traffic lights stay inset and no custom buttons appear.

## Follow-ups

- Windows 11 Snap Layouts (the hover flyout on Maximize) needs `WM_NCHITTEST` support from electrobun. It isn't available.
- Double-clicking the drag area to maximize depends on electrobun's Windows drag-region handling.
