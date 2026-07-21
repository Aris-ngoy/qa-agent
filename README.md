# qa-agent

Local-first agentic mobile QA. Bun + Turborepo monorepo with an Electrobun desktop shell and a TypeScript (Hono) local runner. Phase 1 is **local-only** — no login, no cloud.

## Stack

| Layer | Choice |
|-------|--------|
| Monorepo | Bun workspaces + Turborepo |
| Desktop | Electrobun + React 19 + TanStack Router/Query + Vite + Tailwind CSS v4 |
| Runner | Bun + Hono + Zod (`@qa-agent/runner`) |
| CLI | `qa-agent` (commander) → HTTP to the runner |
| Lint/format | Biome |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- macOS recommended for Electrobun desktop (Phase 1)

## Setup

```bash
bun install
```

## Verify runner health (issue 02)

Terminal A — start the local runner:

```bash
bun run runner
```

Terminal B — call health via the CLI (no credentials):

```bash
bun run health
```

Expected JSON includes `"ok": true` and `"service": "qa-agent-runner"`.

## Other commands

```bash
bun run lint          # Biome
bun run check         # package typechecks + Biome
bun run desktop       # Electrobun desktop (dev)
```

## Workspace layout

```
apps/desktop          Electrobun + React UI
services/runner       Local Hono runner + qa-agent CLI
packages/runner-client
packages/ui
packages/typescript-config
packages/skill/qa-agent-testing
```

### Desktop (`apps/desktop/src`)

Process-first roots (Electrobun), features nested underneath:

```
src/
  bun/                            # Electrobun main process
    index.ts                      # window, menu, RPC handlers
    features/
      ios-toolchain/              # Xcode / signing discovery + prefs
  shared/                         # isomorphic RPC contracts + DTOs
    rpc.ts
    ios-toolchain.ts
  mainview/                       # React renderer (Vite)
    main.tsx
    app/                          # shell, router, RPC client
    features/
      apps/                       # workspace apps + welcome/config
      devices/                    # runs panel + device setup
      settings/                   # settings modal (toolchain RPC)
      test-cases/
      status/
```

- `bun/` must not import React or `mainview/`
- `mainview/` must not import Node APIs or `bun/`
- `shared/` is the only bridge (types + RPC shape)
- Renderer imports use `@/` → `src/mainview`

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full product design.
