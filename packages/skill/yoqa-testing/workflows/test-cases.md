# Workflow: Author Test Cases

The order of work for cases, reusable flows and app context. What each of those *is*:
[Test Cases, Flows & App Context](../concepts/test-cases.md). How to phrase them:
[Writing Good Test Cases](../concepts/writing-test-cases.md). Every command:
[Apps, Cases & Flows](../references/apps-cases-and-flows.md).

## Creating or updating a test case

When updating, read the current case first (`yoqa cases get APP 42 --json`) and run the checks below
for the steps you are adding or changing.

1. **Read the app's code** for the feature: its screens, navigation and business logic.
   **Done when** you can name each screen the scenario passes through.
2. **Read app context** — `yoqa apps get APP --json`. It is injected into every run, so a fact already
   there (credentials, screen names, global rules) stays out of the flows. A shared fact that is
   missing goes into app context ([below](#updating-app-context)), not inline.
3. **Read the reusable flows** — `yoqa flows list APP`. Reference an existing step by `flowId`. A new
   step that will recur across cases (login, onboarding) becomes a
   [reusable flow](#creating-or-updating-a-reusable-flow) first.
4. **Read the existing cases** — `yoqa cases list APP`. If a similar case exists, update it.
5. **Debug-run the scenario** — walk the whole run on a connected device from a **cold launch** through
   to the verification, exactly as you will write it, using [Debug on device](debug-on-device.md).
   A run always starts fresh, so the path includes onboarding and login.
   **Done when** the walkthrough passes end to end from a cold launch, every expected result seen on a
   screenshot.
6. **Write the flows file** — collapse the walkthrough into a JSON array, phrased per
   [Writing Good Test Cases](../concepts/writing-test-cases.md); its shape is in
   [Apps, Cases & Flows](../references/apps-cases-and-flows.md#the-flows-file).
7. **Save it** — show the user the title, tags and file content, get their yes, then:

   ```bash
   yoqa cases create APP --title "Edit display name" --tag smoke --tag profile --flows-file ./flows.json
   yoqa cases update APP 42 --flows-file ./flows.json
   ```

   On `update`, `--flows-file` and `--tag` each **replace** the whole list: write the complete new
   set.
8. **Read it back** — `yoqa cases get APP <number> --json`.
   **Done when** the saved title, tags and every flow match what the user approved.

## Creating or updating a reusable flow

For a step that appears, or will appear, in more than one case — login, onboarding, account setup.
Phrase it to the same bar as an inline step.

```bash
yoqa flows create APP --name "Sign in" --instructions "Sign in with test@example.com / Test1234." --result "The Home screen is visible with the search bar."
yoqa flows update APP <flow-id> --result "The Home screen is visible."
```

A flag you omit leaves that field unchanged. An update reaches every case that references the flow.

## Updating app context

1. **Read** — `yoqa apps get APP --json`.
2. **Compose the full replacement** — `--context` overwrites, so the new text holds the old content
   plus your additions. Show it to the user and get their yes.
3. **Update** — `yoqa apps update APP --context "<full text>"`.
