# Desktop motion system

## Goal

Add a CSS-first motion system across the Yoqa desktop app: route page transitions, splash→app crossfade, side-menu active indicator, list enter staggers, and light micro-interactions — with `prefers-reduced-motion` support and no Motion/Framer dependency.

## Plan summary

- Prefer native **View Transitions** via TanStack Router (`defaultViewTransition`) over adding an animation library (aligns with HeroUI v3 CSS overlays).
- Animate only `<main>` page content (`view-transition-name: app-page`); keep side menu and runs panel stable.
- Directional slides from route ranks; push/pop for list↔detail; fade for welcome swaps.
- Progressive enhancement: unsupported webviews navigate instantly.

## What shipped

- Motion tokens and VT/keyframes in [`apps/desktop/src/mainview/styles.css`](../../apps/desktop/src/mainview/styles.css)
- Helpers under `apps/desktop/src/mainview/app/motion/`:
  - `route-rank.ts` — pathname → transition type
  - `start-view-transition.ts` — safe `document.startViewTransition` wrapper
  - `use-reduced-motion.ts` — media-query hook
  - `use-enter-once.ts` — mount-once stagger flag
- Router wired in `main.tsx`; `<main className="app-page">` in shell; welcome↔outlet swap via View Transition in `root-layout.tsx`
- BootGate splash opacity crossfade before unmount
- Side menu sliding active pill + badge scale-in
- Test Cases / Runs list fade-up stagger (first load only)
- Play button press scale; live dots use `motion-live-dot` (respects reduced motion)

## How to verify

1. Cold boot: splash fades into the app shell (~400ms).
2. Sidebar: Test Cases ↔ Runs ↔ Configuration — content slides; chrome stays put.
3. Open a case/run detail and navigate back — push/pop feel.
4. Select/deselect app so welcome swaps — fade via View Transition.
5. Load Test Cases / Runs with data — rows stagger once; typing filter does not re-stagger.
6. Enable OS “Reduce motion” — transitions near-instant; no pulse/stagger.

## Follow-ups

- Shared-element morphs between list rows and detail titles
- Status / Configuration page content staggers beyond headers
- Optional VT types for browser history back/forward using `__TSR_index`
