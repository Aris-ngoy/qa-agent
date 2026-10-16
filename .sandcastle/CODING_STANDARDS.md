# Coding Standards

The reviewer agent loads this file during review. The full rules live in `AGENTS.md`, `CONTRIBUTING.md`, `CONTEXT.md` and `docs/adr/`; this is the checklist.

## Style

- TypeScript throughout; Biome formats and lints (tabs, double quotes). `bun run lint:ci` must pass.
- Match the surrounding code: its comment density, naming and idioms. Comments say why, not what.
- No `any`, no unchecked casts; validate inputs at the HTTP and CLI edges with Zod schemas from the runner client.
- Use the domain glossary in `CONTEXT.md` for names (Device Session, Lane, Screen, Action, Grounding, Settle, Run, Case Script…) and avoid its _Avoid_ terms.

## Testing

- Test external behaviour at the highest existing seam, not implementation details.
- A Lane joins the Lane contract suite through a harness that fakes its device tool; Run behaviour goes through the Case executor seam (ADR-0003).
- Catalog changes are additive: an old database must still open, and saved rows must still parse.
- `bun run test` and `bun run check` must pass.

## Architecture

- A Lane is Direct only (ADR-0005): no WebDriver, no Appium, no second Lane, and no Appium wording in the product.
- At most one Device Session per device id (ADR-0001).
- iOS and Android behaviour must not change unless the issue says so.
- `CONTEXT.md` is a glossary only, with no implementation detail. Record hard-to-reverse, surprising trade-offs as ADRs.
