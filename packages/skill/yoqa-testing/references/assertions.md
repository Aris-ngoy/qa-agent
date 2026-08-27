# Assertions

`yoqa assert` checks that text is (or is not) on screen and **exits non-zero when it isn't**. Use it as
the verify step of the debug loop instead of re-reading `yoqa screen` and judging by eye — it waits for
the condition, so it also absorbs animation and network delay.

```bash
yoqa assert visible -t "<text>" [--timeout <seconds>]
yoqa assert not-visible -t "<text>" [--timeout <seconds>]
```

```bash
yoqa assert visible -t "Welcome back"
yoqa assert visible -t "Order placed" --timeout 15
yoqa assert not-visible -t "Loading"            # wait for a spinner to disappear
```

- `-t` / `--text` is required.
- `--timeout` is in **seconds**, default `5`. The screen is re-polled until the condition holds or the
  timeout expires.
- Matching is a **case-insensitive substring** against each element's label *or* its type. `-t "login"`
  matches a `Login` button. Short, generic text can match more than you intend — prefer a distinctive
  phrase.
- Only the cleaned element tree is searched, so text drawn into an image or a canvas will not be found.
  Verify those with `yoqa screenshot` instead.
- Requires a connected device. No AI provider needed.

`assert not-visible` succeeds as soon as the text is absent, which includes the case where it was never
there. It confirms a state, not a transition — assert the text is visible first if you need to prove
something actually disappeared.
