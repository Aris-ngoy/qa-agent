# Workflow: Test Cases & Reusable Flows

> This page is the **process** — the order of steps and which checks to run before writing.
> For how to phrase instructions and results, follow [Writing Good Test Cases](../concepts/writing-test-cases.md) as you write each flow.
> Concepts: [Test Cases, Flows & App Context](../concepts/test-cases.md) · Commands: [Apps, Cases & Flows](../references/apps-cases-and-flows.md)

## Setting up app context

Do this before authoring cases — shared facts (credentials, screen names, global rules) belong in app
context, not repeated in every flow.

1. **Read the current context** — `yoqa apps get APP --json`.
2. **Compose the full replacement** — `--context` overwrites, so include both the old and the new
   content. Confirm the exact text with the user before sending.
3. **Update** — `yoqa apps update APP --context "<full text>"`.

See [Apps, Cases & Flows](../references/apps-cases-and-flows.md) and the
[App Context](../concepts/test-cases.md) concept.

## Creating or updating a test case

Same checks either way. When updating, first read the current case to see its existing flows, then run
the checks below only for the steps you're adding or changing.

1. **Analyse the app code** — read relevant source files to understand the feature: screens, navigation,
   business logic. You can't write precise steps for a screen you haven't looked at.
2. **Check app context** — read it first (`yoqa apps get APP --json`). It's injected into every run
   automatically, so anything already there (credentials, screen names, global rules) must NOT be repeated
   inside flows. If a shared fact is missing, add it to app context instead of inlining it (see
   [Setting up app context](#setting-up-app-context)).
3. **Check existing reusable flows** — `yoqa flows list APP`. If a step already exists, reference it by
   `flowId` rather than rewriting it. If a new step will recur across cases (login, onboarding), create a
   reusable flow first, then reference it.
4. **Check existing test cases** — `yoqa cases list APP`. When creating, if a similar case already exists,
   update it instead of making a near-duplicate.
5. **Debug-run the scenario first (required)** — before saving any flows, walk the whole run on a connected
   device **from a clean state** — cold launch through the verification — exactly as you intend to write it.
   Use [Debug on device](debug-on-device.md). The app always starts fresh, so the path must include
   onboarding/login. This surfaces a wrong path, missing setup, or a bad expected result while it's still
   cheap to fix. Move on only once the scenario passes end-to-end.
6. **Write the flows file** — collapse the validated walkthrough into a JSON array per
   [Writing Good Test Cases](../concepts/writing-test-cases.md): one goal per step, multi-step instructions
   as a numbered list (one action per line), a concrete `expectedResult` on each. Pull repeated prefixes
   (onboarding, login) into reusable flows referenced by `flowId`; write unique steps inline.

   ```json
   [
     { "flowId": "<sign-in-flow-id>" },
     {
       "instructions": "1. Open the Profile screen from the bottom tab bar.\n2. Tap Edit.\n3. Change the display name to \"John Test\".\n4. Tap Save.",
       "expectedResult": "The Profile screen shows \"John Test\" as the display name."
     }
   ]
   ```

7. **Save it** — show the user the title, tags, and file content, get approval, then:

   ```bash
   yoqa cases create APP --title "Edit display name" --tag smoke --tag profile --flows-file ./flows.json
   ```

   When updating, remember `--flows-file` and `--tag` **replace** the whole list — read the case first
   (`yoqa cases get APP 42 --json`) and write the complete new set:

   ```bash
   yoqa cases update APP 42 --flows-file ./flows.json
   ```

8. **Confirm it saved** — `yoqa cases get APP <number> --json` and check the flows and tags are what you
   intended.

## Creating or updating a reusable flow

Create one when the same step appears (or will appear) in more than one test case — e.g. login,
onboarding, account setup. Write its instructions and expected result to the same quality bar as inline
steps ([Writing Good Test Cases](../concepts/writing-test-cases.md)).

```bash
yoqa flows create APP --name "Sign in" --instructions "Sign in with test@example.com / Test1234." --result "The Home screen is visible with the search bar."
yoqa flows update APP <flow-id> --result "The Home screen is visible."
```

Omit a flag to leave that field unchanged. The change propagates to every case that references the flow.
