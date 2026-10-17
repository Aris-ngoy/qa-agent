# Desktop feature layout and Legend-State

## Goal

Give every desktop webview feature the folder layout the Manual Inspector already uses ([inspector/legend-state.md](../inspector/legend-state.md)), and hold all UI state in Legend-State instead of React state hooks, so a feature reads the same wherever you open it.

## Conventions

These apply to `apps/desktop/src/mainview`. `AGENTS.md` carries the short version.

### Folders

Each feature in `features/<feature>/` splits by role:

| Folder | Holds |
|--------|-------|
| `components/` | React components, one per file; a page is `<name>-page.tsx`. |
| `data/api/` | Every runner (`getRunnerClient`) and desktop host (`getDesktopRpc`) call, as plain async functions. |
| `data/state/` | Legend-State observables shared beyond one component, and the state shapes (`initial…()`) components create with `useObservable`. |
| `hooks/` | React hooks that compose state, queries, and effects. |
| `hooks/usequery/` | TanStack Query: query keys, `useQuery` wrappers, and `useMutation` hooks with their cache updates. |
| `utils/` | Pure helpers and their `*.test.ts`. |

`app/` stays the shared shell (router, side menu, resize, pagination, motion, forms, `download.ts`). It follows the same state rules.

A query key lives next to its hook in `hooks/usequery/`, and other features import it from there (`runQueryKey`, `casesQueryKey`, `activeDeviceSessionQueryKey`).

### State

- **Component state:** `const thing$ = useObservable(initial)` and read it with `useValue(thing$)`. Several related fields go in one observable (`panel$`, `wizard$`, `bar$`), each read by its leaf: `useValue(panel$.editing)`.
- **App-wide state:** a module-level `observable()` in `data/state/` with small setter functions (`selectedAppId$` + `selectAppId`, `selectedCaseIds$`, `activeRunId$`, `sidebarStore`, `themeMode$`). These replace the old React contexts (`AppsProvider`, `ActiveRunProvider`, `TestCaseSelectionProvider`) and `useSyncExternalStore` stores. State derived from others is a computed observable (`effectiveTheme$`).
- **Root syncs:** an effect that must run once for the whole app is a hook mounted by a `null` component in `main.tsx` (`AppSelectionSync`, `ThemeSync`, `SidebarShortcut`).
- **Writes outside render:** event handlers, effects, and async callbacks call `.set()` and read with `.peek()`. A write during render is a bug; `usePagination` stores its clamped page in an effect for that reason.
- **Whole values:** set a new object or array (`x$.set((prev) => [...prev, item])`) whenever a component reads that value whole. Legend mutates the stored object in place on a child `set`, so the React Compiler would see the same reference and skip the update.
- **Plain data:** observables hold JSON-like data. A function in an observable becomes a computed, so a value that carries functions (the runner client, URL builders) lives in a TanStack Query (`useRunMediaUrls`) or a ref.
- **Effect deps:** list the observable (`[open, panel$]`); Biome's exhaustive-deps rule asks for it, and it never changes.
- **Lazy initial value:** `useObservable(() => readStored())` reads once, on first use (`usePanelWidth`).

`no-react-state.test.ts` fails when `useState`, `useReducer`, or `useSyncExternalStore` appears in the webview. Context stays fine for compound components that pass props, not state (`providers/components/stepper.tsx`).

## Plan summary

- Two commits: pure `git mv` + import rewrites first, so the Legend and extraction changes read as edits.
- AI providers leave `settings/` for their own `features/providers`, and the Servers & doctor panel joins `features/doctor`, whose doctor report hooks Settings › Diagnostics now shares.
- Large pages split by part: run detail (step rows, case videos, status pill, report-export hook), test case detail (instructions, configuration, script panels), and Settings (one component per section).
- Duplicated queries became one hook each: the app's cases (`useCasesQuery`, four copies), a Run (`useRunQuery`), cancel Run (`useCancelRun`, three copies), listed devices (`useListedDevices`), the doctor report.
- Rejected: Legend's persist plugin for stored preferences (it would rewrite the stored formats and drop existing values); `useObservable` for the cache-only queries in the top bar title (they are TanStack cache reads, kept as is).

## What shipped

- Every feature under `features/` follows the table above; `useState` is gone from the webview.
- `AppsProvider`, `ActiveRunProvider`, and `TestCaseSelectionProvider` are removed; `useApps`, `useActiveRun`, and `useTestCaseSelection` read Legend observables, with the same return shapes.
- A selection clears when the app changes through `selectedAppId$.onChange` in `test-cases/data/state/case-selection.ts`.
- Theme, OS dark mode, and reduced motion are observables that follow `matchMedia` live (`settings/data/state/theme.ts`, `app/motion/reduced-motion.ts`).
- `useStartRun` connects first (through the top bar's connect) and then creates the Run, so one error path shows the toast.
- `devicesQueryKey("ios")` now always caches a `Device[]`. Settings › iOS used to cache the raw `{ devices }` response under the same key the run views cache an array under, so whichever loaded first broke the other.
- Shared helpers: `app/download.ts` (file download, base64), `runs/utils/run-report.ts` (HTML/Markdown export, also used by the Inspector).

### Where files moved

| Before (`features/…`) | After |
|---|---|
| `apps/context.tsx` | `apps/data/api/apps.ts`, `apps/data/state/selected-app.ts`, `apps/hooks/use-apps.ts`, `apps/hooks/usequery/use-apps-query.ts` |
| `apps/*-page.tsx`, `add-application-modal.tsx` | `apps/components/` |
| `devices/session-*.tsx`, `select-device-modal.tsx`, `trust-developer-dialog.tsx`, `web-device-panels.tsx` | `devices/components/` |
| `devices/session-{app,device,status}.ts`, `web-device.ts` | `devices/utils/` |
| `devices/use-active-device-session.ts` | `devices/hooks/usequery/` (+ `use-devices.ts`) |
| `devices/servers-doctor-panel.tsx` | `doctor/components/` |
| `doctor/status-ui.tsx` | `doctor/components/` |
| `runs/detail-page.tsx`, `list-page.tsx` | `runs/components/run-detail-page.tsx`, `runs-list-page.tsx` |
| `runs/active-run-context.tsx` | `runs/data/state/active-run.ts`, `runs/hooks/use-active-run.ts`, `runs/hooks/usequery/use-run.ts` |
| `runs/labels.ts`, `viewer-zoom.ts` | `runs/utils/` |
| `settings/settings-page.tsx` | `settings/components/` (one file per section) |
| `settings/providers/*` | `providers/` |
| `settings/sidebar-store.ts`, `use-theme-mode.tsx` | `settings/data/state/sidebar.ts`, `theme.ts` |
| `splash/boot-gate.tsx` | `splash/components/` (+ `data/api/boot.ts`) |
| `test-cases/data.ts` | `test-cases/utils/catalog-case.ts`, `data/api/cases.ts`, `hooks/usequery/use-cases.ts` |
| `test-cases/detail-page.tsx`, `list-page.tsx` | `test-cases/components/test-case-detail-page.tsx`, `test-cases-page.tsx` |
| `test-cases/selection-context.tsx` | `test-cases/data/state/case-selection.ts`, `hooks/use-test-case-selection.ts` |

## How to verify

1. `bun run lint:ci`, `bun run test`, `bun run check`. `no-react-state.test.ts` is part of the tests.
2. `bun run desktop`: add an app, create a test case, edit and save it, switch its tabs, tick it in the list (the top bar shows **Run test**), filter, open Runs, the device picker, the Servers & doctor panel, Inspector, Configuration, and every Settings section. Toggle the theme and collapse the side menu (⌘B). Switch apps: the case selection clears.
3. Start a Run on a device: the run page polls, **Stop** cancels from the run page and from the top bar chip, and **Export HTML** downloads a report once it ends.

## Follow-ups

- Older build notes under `docs/` still link the paths in the left column of the table above.
- The top bar title's cache-only `useQuery` calls log "No queryFn" in dev (this predates the refactor).
