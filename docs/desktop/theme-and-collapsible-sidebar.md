# Theme and collapsible sidebar

## Goal

Ship Light / Dark / System appearance and a collapsible side menu as one feature, with the sidebar staying a distinct floating card in dark mode (ticket #280, parent #275).

## Plan summary

- Delivered as stacked tickets: preferences module (#276), dark theme (#277), collapsible menu (#278), dark-mode coverage (#279), and this sidebar styling and write-up (#280).
- The sidebar keeps its own tokens (`--color-sidebar*`) rather than reusing surface tokens, so it can sit slightly lighter than the dark canvas.
- Rejected: a dark sidebar darker than the canvas — it disappears against the background and loses the floating-card look.

## What shipped

- Dark `--color-sidebar` is `#1e2030` (canvas `#12131a`), with explicit dark `--color-sidebar-fg`, `-muted` and `-active` tokens.
- The side menu card has a 1px `border-sidebar-fg/10` edge so it separates from the canvas in expanded and collapsed (icon rail) states, in both themes.
- Feature docs: [ui-preferences.md](ui-preferences.md), [dark-theme.md](dark-theme.md), [collapsible-side-menu.md](collapsible-side-menu.md), [dark-mode-coverage.md](dark-mode-coverage.md).

## How to verify

```bash
bun run lint:ci && bun run test && bun run check
```

In the app: for each of light/dark x expanded/collapsed (Settings → Appearance, ⌘B), confirm the side menu reads as a separate card against the canvas. All four combinations were checked against the app's stylesheet in a browser render of the real card classes; a pass in the full Electrobun app is still open.

## Follow-ups

- Full-app visual pass of all four combinations in Electrobun.
