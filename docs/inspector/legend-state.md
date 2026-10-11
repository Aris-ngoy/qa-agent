# Inspector Legend-State layout

## Goal

Keep the Manual Inspector's behavior and give the feature one folder layout: UI in `components`, runner calls in `data/api`, Legend-State in `data/state`, TanStack Query in `hooks/usequery`, and pure helpers in `utils`. Remove every `useState` in this feature.

## Plan summary

- A few atoms for state that lives with the page visit: the existing feed (`feed$`), the script session (`script$`), and page visibility (`page$`). Created with `useObservable` so they reset when the page unmounts, same as the old `useState`.
- Dialog, gesture, hover, and frame-buffer state stays inside the component with `useObservable`, because it resets when that component mounts.
- Components read with `useValue`. Writers outside render use `peek()` / `set()`. A run's start and finish set several script fields inside `batch()` so the page renders once.
- Hover and Control-pick highlights subscribe in a child (`PointerChrome`), so pointer moves do not re-render the screenshot panel.
- Slot updates and the live-control hover clear use `useObserveEffect` (after render), the same timing as the `useEffect`s they replaced, so the store is not written during render.
- Rejected: one app-wide store, `For` with `optimized` (the log and step lists are short; that mode reuses React nodes), and moving `useActiveDeviceSession` out of the devices feature.

See [Manual Inspector](../desktop/manual-inspector.md) and [manual connect](../desktop/inspector-manual-connect.md) for the product behavior this layout keeps.

## What shipped

- `apps/desktop/src/mainview/features/inspector/components/` — page, screenshot, script, element dialog, gestures, save-as dialog, live frame.
- `data/api/` — screen reads, shell-script runs, create-case.
- `data/state/` — `InspectorFeedController` and the script/page state shapes.
- `hooks/use-inspector-feed.ts` — controller ref, visibility, tree refresh, screenshot poll, live-control socket. The controller is created once into that ref. Building a new one on every render dropped the feed on the update Connect itself caused, so the card returned to "Inspector not connected".
- `hooks/use-script-session.ts` — append, run, stop, copy, export, save-as.
- `hooks/usequery/` — wraps the shared active-session query and the save-as-case mutation.
- `utils/` — selection, snippets, script steps, pointer math, session errors, frame slots, report download. Tests moved with them.

The route imports `InspectorPage` from `components/inspector-page`.

## How to verify

1. Open **Inspector** with a device already connected in the top bar. The feed starts on its own. **Disconnect** stops it until **Connect** or a new device session.
2. Connect, hover an element (the highlight follows the pointer), click to select, insert a command, and run it. The script log and the active step update. **Stop** aborts the run.
3. Hide the window. The screenshot poll pauses and resumes when the window is visible again.
4. **Save as test case** opens with the suggested name. Cancel closes it. Saving still creates the case and opens it.
5. `bun test apps/desktop/src/mainview/features/inspector` and `bun run --cwd apps/desktop check`. A search of `features/inspector` for `useState` is empty.

## Follow-ups

- None.
