# Desktop forms with react-hook-form

## Goal

Use `react-hook-form` for every data-entry form in the desktop app, replacing hand-rolled `useState` form blobs with a shared HeroUI binding layer.

## Plan summary

- Install `react-hook-form` in `@yoqa/desktop` only.
- Bind HeroUI `TextField` / `Select` via thin `Controller` wrappers (`RhfTextField`, `RhfSelectField`).
- Keep validation as RHF `rules` (trim/required/step guards). No Zod / `@hookform/resolvers` in the UI — Zod stays API-only in `@yoqa/runner-client`.
- Use `useFieldArray` for dynamic rows (capabilities, env vars, flows).
- Leave search filters, device-run selects, and settings toolchain preference `Select`s as local state (not submit forms).

## What shipped

| Surface | File |
|---------|------|
| Shared helpers | [`apps/desktop/src/mainview/app/forms/`](../../apps/desktop/src/mainview/app/forms/) |
| Create application | [`add-application-modal.tsx`](../../apps/desktop/src/mainview/features/apps/add-application-modal.tsx) |
| App configuration | [`configuration-page.tsx`](../../apps/desktop/src/mainview/features/apps/configuration-page.tsx) |
| Test case editor | [`detail-page.tsx`](../../apps/desktop/src/mainview/features/test-cases/detail-page.tsx) |
| Add provider wizard | [`add-provider-modal.tsx`](../../apps/desktop/src/mainview/features/settings/providers/add-provider-modal.tsx) |
| Edit provider | [`provider-expanded.tsx`](../../apps/desktop/src/mainview/features/settings/providers/provider-expanded.tsx) |

Patterns:

- `useForm` + `reset(...)` when the entity opens or loads
- HeroUI `<Form onSubmit={handleSubmit(...)}>` for Enter-to-submit
- `formState.isDirty` / watched values for Save enablement
- Wizard UI step state stays outside RHF; field values live in the form

## How to verify

1. `cd apps/desktop && bun run check`
2. Create an app (modal); confirm empty name disables Create and Enter submits when valid
3. Edit app settings (name/context/caps); Save enables only when dirty
4. Edit a test case (flows, tags, capabilities, locale); Save / duplicate still work
5. Add a provider through the wizard; edit an existing provider and Save

## Follow-ups

- None required for this migration. Optional later: Zod schemas shared with `@yoqa/runner-client` via `@hookform/resolvers` if form and API validation should stay in lockstep.
