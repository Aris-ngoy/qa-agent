# Apps, Cases & Flows

All catalog commands are **flag-based**. None of them take a JSON blob as an argument.

## Apps

```bash
yoqa apps list                                        # all apps (PREFIX, NAME)
yoqa apps get APP                                     # details, including the current app context
yoqa apps get APP --json                              # raw JSON (use to read the full context)
yoqa apps create --name "My App"                      # prefix is allocated from the name
yoqa apps create --name "My App" --prefix myapp --ios-bundle-id com.example.app
yoqa apps update APP --context "<full replacement text>"
yoqa apps update APP --name "New name"
yoqa apps update APP --ios-bundle-id com.example.app --android-application-id com.example.app
```

The app **context** is a shared description injected into every test run — use it for credentials,
screen names, and general rules the agent should always follow. `--context` **overwrites**, it does not
append: read the current value with `yoqa apps get APP --json` first, then send the old text plus your
additions.

> **Always confirm with the user before running `apps update`** — show the exact text you plan to send
> and wait for explicit approval.

## Cases

A **test case** describes a single scenario to verify — a title, optional tags, and a list of flows that
define the steps and expected results.

```bash
yoqa cases list APP                          # cases as `#<number>  <title>`
yoqa cases list APP --tag smoke              # filter by tag
yoqa cases list APP --tag smoke --tag auth   # repeatable: a case must carry every tag
yoqa cases get APP 42                        # case detail
yoqa cases get APP 42 --json                 # full JSON, including flow ids
yoqa cases delete APP 42                     # delete a case (irreversible)
```

### Creating and updating

Flows come from a **JSON file** passed with `--flows-file`; tags from a repeatable `--tag`.

```bash
yoqa cases create APP --title "Edit display name" --tag smoke --tag profile --flows-file ./flows.json
yoqa cases create APP --title "Smoke: launch"                       # title only, add flows later
yoqa cases update APP 42 --title "New title"
yoqa cases update APP 42 --flows-file ./flows.json                  # REPLACES all flows
yoqa cases update APP 42 --tag smoke --tag regression               # REPLACES all tags
```

The flows file is a JSON **array** of steps, in the order the agent runs them. Each step is either an
inline step or a reference to a reusable flow:

```json
[
  { "flowId": "<reusable-flow-id>" },
  {
    "instructions": "1. Open the Profile screen from the bottom tab bar.\n2. Tap Edit.\n3. Change the display name to \"John Test\".\n4. Tap Save.",
    "expectedResult": "The Profile screen shows \"John Test\" as the display name."
  }
]
```

- **inline step** — `{"instructions": "...", "expectedResult": "..."}`, unique to this case.
  `expectedResult` is optional; without it the agent only checks the step completed without errors.
- **reusable reference** — `{"flowId": "..."}`, pointing at a shared flow (get ids from `yoqa flows list APP`).
- A step is one or the other, never both.
- The field is `expectedResult`, **not** `result` — an unknown key is rejected with an error rather than
  silently dropped, so a typo fails loudly.
- `--flows-file` and `--tag` on `update` are **full replacements**, not merges. To append, read the
  current case with `yoqa cases get APP 42 --json`, and write the complete new list.
- Tags are created automatically if they don't exist.
- On `update` a step may also carry its existing `id` (from `cases get --json`) to keep that step's identity.

> For how to phrase `instructions` and `expectedResult` (numbered steps, one goal per flow, concrete
> results) follow [Writing Good Test Cases](../concepts/writing-test-cases.md).

> **Before writing any inline step**, run `yoqa flows list APP` and check whether a matching reusable
> flow already exists. If it does — reference it by `flowId`. If the step will appear in multiple cases —
> create a reusable flow first, then reference it.

> **Always confirm with the user before running `cases create` or `cases update`** — show the exact title,
> tags, and flows file content you plan to send and wait for explicit approval.

> **`cases delete` is destructive and irreversible — always get explicit user approval first.** Name the
> exact case (number + title) you intend to delete and wait for confirmation. Never delete a case the
> user didn't ask you to remove.

## Reusable flows

A **reusable flow** is a named step shared across multiple test cases — e.g. "Go through onboarding".
Instead of repeating the same instructions in every case, reference it by `flowId`.

```bash
yoqa flows list APP                          # flows as `<id>  <name>`
yoqa flows get APP <flow-id>                 # name, instructions, expected result
yoqa flows get APP <flow-id> --json
yoqa flows create APP --name "Sign in" --instructions "Sign in with test@example.com / Test1234." --result "The Home screen is visible."
yoqa flows update APP <flow-id> --instructions "..."
yoqa flows delete APP <flow-id>              # irreversible
```

Note the flag is `--result` here (it sets the same `expectedResult` field the flows file uses). Any
combination of `--name`, `--instructions`, `--result` can be updated — omit a flag to leave that field
unchanged. The change propagates to every case that references the flow.

`flows delete` fails if the flow is still used by any test case — the server returns
"Cannot delete flow: it is used in N case(s)". Remove or re-point those cases first.

> **Always confirm with the user before running `flows update`** — show the exact values you plan to send
> and wait for explicit approval.

> **`flows delete` is destructive and irreversible — always get explicit user approval first.** Name the
> exact flow (id + name) you intend to delete and wait for confirmation. Never delete a flow the user
> didn't ask you to remove.

## Tags

Tags are created automatically when you pass them with `--tag` on `cases create` / `cases update`. There
is no separate create step.

```bash
yoqa tags APP                      # list tag names
yoqa tags APP --json               # raw JSON (id, appId, name)
```

You may reuse existing tags freely, but confirm with the user before attaching tags to a case —
especially when it would create a new tag rather than reuse one from `yoqa tags APP`.
