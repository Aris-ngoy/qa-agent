# Targeting Elements (`--id`, `--label`, `--description`)

Rungs 2 and 3 of the [targeting ladder](../SKILL.md#targeting-ladder): `yoqa action tap` and
`yoqa action input` find their target for you. Of the flags you pass, the first in this order wins:

| Flag | How it resolves | Needs an AI provider | Use when |
|---|---|---|---|
| `--id <id>` | exact match on the element's identifier in the cleaned tree, then a `…/id` suffix match | no | the element has a resource-id / accessibility id |
| `--label <text>` | exact label match, else substring; smallest matching element wins | no | the element has visible text or an accessibility label |
| `-d`, `--description <text>` | a vision model locates it in a screenshot (grounding) | **yes** | nothing stable to match on — custom-drawn UI, icons, images |

Start on `--id` / `--label` instead of a point when you already know the identifier (a `testID` or
`accessibilityLabel` in the app's code), or when the same step must stay stable across layouts. Read
the exact value from `yoqa screen` ([Inspect & App Control](inspect-and-app-control.md)); ids appear
only in `yoqa screen --json`. Swipe and drag take coordinates only.

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

Grounding is only as good as the description:

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

## When a target isn't found

`--id` and `--label` fail fast with `No element matching id: …` / `No element matching label: …`: the
element is not in the cleaned tree. That is a miss — on the fresh screenshot, check whether the element
is offscreen (scroll to it), covered by a system sheet, unlabeled (use a point), or on a screen you
have not reached yet.
