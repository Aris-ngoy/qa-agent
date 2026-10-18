---
status: accepted
---

# A Case Script's action list is recursive: a Branch holds more steps

Optional UI (a permission sheet, a "rate this app" prompt, onboarding on first launch) made authors keep one Case Script per variant, or accept a script that fails whenever that UI does or does not appear. We added a **Branch** to the catalog's Case Script model (not only to the file format): a step that checks the Screen for one target, waiting up to a timeout, and runs its `then` or `else` list. Those lists hold ordinary Case Script steps, Branches included, so the action list is now recursive. `version` stays `1`: a runner that does not know `branch` rejects the script, which is what we want (it never silently drops steps).

- **Part of the model, not the file.** Runs, the CLI and the Inspector all read the same Case Script, so a Branch written in a Case Script file means the same thing wherever it runs. In a file it is the one-key item `- if:`, like every other action (ADR 0006).
- **Not an Action.** A Branch reads the Screen; it never gestures and never calls a Provider. A Case Script is still replayed without any live decide.
- **Nesting instead of `else-if`.** A Branch inside `else` covers a chain; there is no depth limit.

## Considered options

- **Flat `skipIfMissing` / `optional: true` on single actions:** rejected. It covers "tap it if it's there" but not a different path through the app.
- **`else-if` chains or any-of / all-of conditions:** rejected for now. Nesting covers chains, and one target per Branch keeps the timeline readable.
- **Conditions on anything but Screen presence (vision, variables, loops):** out of scope. They would turn a Case Script into a program.

## Consequences

- Every place that walks Case Script actions has to handle a list that holds lists: the file codec (errors carry a nested position such as `action 3 → then → action 2`), the Case executor, client-side replay, shell export and the desktop summaries.
- Once files in the wild use `if:`, removing Branches would break them. Building a Case Script from agent decisions never produces one.
