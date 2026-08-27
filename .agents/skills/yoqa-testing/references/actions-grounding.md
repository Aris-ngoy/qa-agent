# Targeting Elements (`--id`, `--label`, `--description`)

`yoqa action tap` and `yoqa action input` can find their target for you, three ways. They are tried in
this order and the first one you pass wins:

| Flag | How it resolves | Needs an AI provider | Use when |
|---|---|---|---|
| `--id <id>` | exact match on the element's identifier in the cleaned tree, then a `…/id` suffix match | no | the element has a resource-id / accessibility id |
| `--label <text>` | exact label match, else substring; smallest matching element wins | no | the element has visible text or an accessibility label |
| `-d`, `--description <text>` | a vision model locates it in a screenshot (grounding) | **yes** | nothing stable to match on — custom-drawn UI, icons, images |

**Prefer `--id`, then `--label`.** They read the same tree you just inspected, are deterministic, cost
nothing, and need no provider. Reach for `--description` when neither is available, or when `--id` /
`--label` match the wrong element and you can't narrow them.

> **`swipe` and `drag` do not accept `--id`, `--label`, or `--description`.** Only `tap` and `input`
> resolve a target. Swipe and drag are coordinate-only — see
> [Actions by coordinates](actions-coordinates.md).

**Always `yoqa screen` first** to confirm the target is on screen — and to read the exact label or id
you are about to pass. See [Inspect & App Control](inspect-and-app-control.md). `--id` values come from
`yoqa screen --json`; the default output does not print them.

## Tap

```bash
yoqa action tap --id <id> [--double] [--duration <ms>]
yoqa action tap --label <text> [--double] [--duration <ms>]
yoqa action tap -d "<description>" [--double] [--duration <ms>]
```

```bash
yoqa action tap --id login_button
yoqa action tap --id com.example.app:id/login_button   # fully-qualified also works
yoqa action tap --label "Login"
yoqa action tap --label "Sign in" --double
yoqa action tap --label "Inbox" --duration 3000         # long-press: duration is MILLISECONDS
```

`--duration` is in **milliseconds**. `--duration 3` is a 3 ms tap, not a 3-second press.

## Input text

`input` taps the resolved target first (to focus it), then types. Omit all targeting flags to type into
whatever is already focused.

```bash
yoqa action input --text "john@example.com" --label "Email"
yoqa action input --text "john@example.com" --id email_field
yoqa action input --text "hello"                         # types into the focused field
```

## Writing a good `--description`

Only relevant for the grounding path. Quality of grounding depends entirely on the description:

- **Be specific** — include color, size, icons, and distinctive features (labels, placeholders).
- **Include exact visible text in quotes** — e.g. `"'Continue' button"`, not `"continue button"`.
- **Mention position if relevant** — top/bottom, left/right/center.
- **Describe exactly ONE element** — never use "or", "any", or "similar".
  - ❌ `"'Play as Guest' button or similar option"`
  - ✅ `"green 'Play as Guest' button below the login form"`
- **Describe only what is visible**, not assumptions about the app's UI.

```bash
yoqa action tap -d "blue 'Login' button at bottom center"
yoqa action tap -d "map area in the center of the screen" --double
yoqa action input --text "shoes" -d "search field with placeholder 'Search'"
```

Grounding requires a configured AI provider (`yoqa status` shows `provider: …`). If it isn't
configured, or grounding keeps mislocating the target, use `--id` / `--label` / coordinates instead.

## When a target isn't found

`--id` and `--label` fail fast with `No element matching id: …` / `No element matching label: …`. That
means the element is not in the cleaned tree — re-run `yoqa screen`, and check whether it is offscreen
(scroll to it first), unlabeled (use `--id` or coordinates), or on a screen you haven't reached yet.
Do not retry the same selector twice; re-inspect instead.
