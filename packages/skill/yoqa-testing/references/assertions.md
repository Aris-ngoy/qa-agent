# Assertions

`yoqa assert` checks that text or an element id is (or is not) on screen and **exits non-zero when it
isn't**. Use it as the verify step of the debug loop for text, alongside a screenshot — it waits for the
condition, so it also absorbs animation and network delay.

```bash
yoqa assert visible -t "<text>" [--timeout <seconds>]
yoqa assert not-visible -t "<text>" [--timeout <seconds>]
yoqa assert visible --id <id> [--timeout <seconds>]
yoqa assert not-visible --id <id> [--timeout <seconds>]
```

```bash
yoqa assert visible -t "Welcome back"
yoqa assert visible -t "Order placed" --timeout 15
yoqa assert not-visible -t "Loading"            # wait for a spinner to disappear
yoqa assert visible --id onboarding-skip        # an element id, when the text is ambiguous or localized
```

- Pass exactly one of `-t` / `--text` or `--id`; both, or neither, is an error.
- Exit status: `0` the condition held, `1` it did not by the timeout, `2` it could not be checked (runner
  not answering, screen unreadable until the timeout, bad flags). In a shell `if`, treat `2` as a failure,
  not as "not visible".
- `--timeout` is in **seconds**, default `5`. The screen is re-polled until the condition holds or the
  timeout expires.
- Matching is a **case-insensitive substring** against each element's label *or* its type. `-t "login"`
  matches a `Login` button. Short, generic text can match more than you intend — prefer a distinctive
  phrase.
- `--id` matches an element id (Android resource-id, iOS accessibility identifier, web `id`) the way
  `yoqa action tap --id` does: exact and case-insensitive, and a short id like `get_bonus` also matches
  `com.app:id/get_bonus`. It is never a substring of the label.
- Only the cleaned element tree is searched, so text drawn into an image or a canvas will not be found.
  Verify those with `yoqa screenshot` instead.
- Requires a connected device. No AI provider needed.

`assert not-visible` succeeds as soon as the text is absent, which includes the case where it was never
there. It confirms a state, not a transition — assert the text is visible first if you need to prove
something actually disappeared.
