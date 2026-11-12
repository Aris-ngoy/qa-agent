# Apps, Cases & Flows

All catalog commands are **flag-based**; none takes a JSON blob as an argument. Every write and delete
here waits for the user's yes — see the [guardrail](../SKILL.md#guardrail). What a case, flow and app
context are: [Test Cases, Flows & App Context](../concepts/test-cases.md).

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
yoqa apps create --name "My Site" --web-url https://app.example.com   # web-only: a name and a Web URL
yoqa apps update APP --web-url http://localhost:8081  # the page a Run on web opens first
```

`--context` **overwrites**, it does not append: read the current value with `yoqa apps get APP --json`
first, then send the old text plus your additions.

## Cases

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

### The flows file

A JSON **array** of steps, in the order the agent runs them. Each step is either an inline step or a
reference to a reusable flow:

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

How to phrase `instructions` and `expectedResult`:
[Writing Good Test Cases](../concepts/writing-test-cases.md).

## Reusable flows

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

## Tags

Tags are created automatically when you pass them with `--tag` on `cases create` / `cases update`. There
is no separate create step.

```bash
yoqa tags APP                      # list tag names
yoqa tags APP --json               # raw JSON (id, appId, name)
```

Reuse a tag from `yoqa tags APP` where one fits; a tag that would be new is part of what you show the
user before saving the case.
