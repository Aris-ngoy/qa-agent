# Key Action on every platform

## Goal

Add a `key` Action: one named key from a fixed set (Enter, Tab, Escape, Backspace, Delete, the four arrows, Home, End, PageUp, PageDown, Space), with optional modifiers (Shift, Control, Alt, Meta). It works everywhere Actions do: the agent's decisions, the connector's `POST /action`, Case Scripts and Case Script files, and `yoqa action key`. Each Lane declares which keys it can press, and a key it cannot press fails the Action with a clear error. Ticket [#307](https://github.com/Aris-ngoy/qa-agent/issues/307), part of web support ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). Vocabulary: **Action**, **Lane**, **Case Script** in [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **One vocabulary in `@yoqa/runner-client`.** `KEY_NAMES` and `KEY_MODIFIERS` (`keyNameSchema`, `keyModifierSchema`) are the only list. The action request, the Case Script action, the agent decision, the agent prompt and the CLI help all read it, so they cannot drift apart.
- **Each Lane declares its keys.** `DeviceSession.keySupport` is `{ keys, modifiers }`, and `DeviceSession.key(name, modifiers)` checks it with `assertKeySupported` before anything reaches the device. A miss throws `UnsupportedKeyError`, which names the key and the device and lists what it can press. `performAction` turns that into an `ActionValidationError`. Over HTTP that is a 400, and in a Run the agent decides again with the error in front of it.
- **What each Lane sends:**

  | Lane | Keys | Modifiers | How |
  |------|------|-----------|-----|
  | Web (CDP) | all | yes | `Input.dispatchKeyEvent`: each modifier goes down, then the key with the modifier bits, then everything comes up in reverse. Enter and Space type their character unless Control, Alt or Meta is held. |
  | Android (adb) | all | yes | `input keyevent <code>`; with modifiers, `input keycombination <modifiers…> <code>` (Android 13 and later). |
  | iOS simulator (idb) | all | no | `idb ui key <HID usage>`. It presses and releases one key, so it cannot hold a modifier. |
  | Cabled iPhone (YoqaRunner) | Enter, Backspace, Space | no | `keyboardReturn`, `keyboardDelete`, and typed `" "`: what the runner can already send on the phone's keyboard. |

- **Rejected:** a silent no-op for unsupported keys (a Case would pass a step it never ran). Also rejected: new `YoqaRunner` or `yoqa-sim` commands for more iPhone and simulator keys, because native changes cannot be built or checked in this slice. The iPhone and simulator declare what they can send today.
- **Shell and file forms.** The CLI line is `yoqa action key Tab --modifiers Shift,Control`, with the key and modifiers in any case. The Case Script file short form is `- key: Enter`, and the long form is `- key: { key: Tab, modifiers: [Shift] }`.

## What shipped

- **Schemas** (`@yoqa/runner-client`): the `key` action kind with `key` and `modifiers` on the action request, and the `key` Case Script action. `keys.ts` adds `parseKeyName`, `parseKeyModifiers` and `formatKeyChord`.
- **Case Scripts:** replay (`caseScriptActionRequest`), the shell export, shell-to-Case-Script conversion, the file's short form and field order, and run-report summaries ("Press Shift+Tab") and commands all cover `key`.
- **Runner**
  - `lane.ts`: `KeySupport`, `DeviceSession.keySupport` / `key`, `UnsupportedKeyError`, `assertKeySupported`.
  - Lanes: `web-direct-lane.ts` (`CDP_KEYS`, `CDP_MODIFIERS`, and newlines in `type` reuse the same key press), `android-direct-lane.ts` with `adbKeyArgs` in `adb-input.ts`, `ios-direct-lane.ts` (`IOS_HID_KEYCODES`), and `ios-device-lane.ts`.
  - `interaction.ts`: `performAction` handles `key`.
  - Agent: `key` in the decision schema, the prompt's shapes and rules (both Screen modes), recent-action lines, `decisionToActionRequest`, recording into a Case Script, and replay in the Case executor.
- **Lane contract suite:** two new cases run on every harness. Every declared key reaches the device, with all modifiers on a Lane that holds them. Every undeclared key, and modifiers on a Lane that cannot hold them, fail with `UnsupportedKeyError` and reach nothing. Each harness reads keys back from its faked tool: adb keycodes, idb HID codes, YoqaRunner commands, and CDP key events (`fake-cdp.ts` now records every key event).
- **CLI:** `yoqa action key <key> [--modifiers <list>]`, with the usual `--screenshot`, `--json` and related options.
- **Desktop:** the Inspector's step list and the Test Case script summary show "Press Shift+Tab".
- **Glossary:** **Action** in `CONTEXT.md` lists `key`.

## How to verify

```bash
bun test services/runner/src/domains/devices/lane-contract.test.ts -t "key"
bun test packages/cli/src/action-key.test.ts packages/runner-client/src/case-script-file.test.ts
bun run lint:ci && bun run test && bun run check
```

By hand, against a connected web device (see [web-attach-by-port.md](./web-attach-by-port.md)):

```bash
yoqa action tap --x 500 --y 300                 # focus a field
yoqa action key Tab --modifiers shift           # focus moves back one field
yoqa action key Enter --screenshot              # the form submits
```

On a cabled iPhone, `yoqa action key Escape` fails with "The Escape key is not available on a cabled iPhone; it can press Enter, Backspace, Space".

## Follow-ups

- More keys on the iPhone and the iOS simulator need new `YoqaRunner` / `yoqa-sim` commands (XCUITest `typeKey` with modifier flags, or HID down/up through `yoqa-sim`).
- The `yoqa-testing` skill and public docs should describe `key` ([#312](https://github.com/Aris-ngoy/qa-agent/issues/312)).
- The desktop Inspector's command bar has no key picker yet.
