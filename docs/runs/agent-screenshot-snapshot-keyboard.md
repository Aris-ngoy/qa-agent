# Agent Dual Screenshot/Snapshot Context & Keyboard Handling

## Goal

Allow the QA agent to utilize both visual screenshots and screen snapshots (accessibility tree) for rich context, giving it the autonomy to decide whether to target elements using normalized `x,y` coordinates or snapshot `id` attributes. Support textfield and keyboard handling so the agent can tap away to dismiss soft keyboards, press Return/newline on the virtual keyboard, and dismiss keyboards before tapping obscured app buttons.

## Plan summary

- Reframe agent system instructions to emphasize dual context: visual context (colors, icons, drawn controls, modals, keyboard state) alongside structural context (semantic IDs, accessibility labels, element bounds).
- Replace rigid "always prefer id" guidance with explicit decision criteria for choosing between clean unique `id` locators and direct `x,y` coordinates (e.g. custom canvas, drawn buttons, ambiguous container IDs).
- Teach three keyboard management patterns for textfields:
  1. Tapping away on empty/neutral background areas outside textfields to dismiss the soft keyboard.
  2. Pressing Return/Done/Nextline on the virtual keyboard itself or typing `\n`.
  3. Dismissing the keyboard first when app buttons are obscured underneath it.
- Map `\n` and `\r` to the W3C Return key (`\uE007`) in W3C key actions for drivers falling back from `mobile: type`.
- Rejected alternative: blindly guessing keyboard dismiss commands via driver heuristics without agent awareness; having the model see and manage the keyboard as part of its screen state is far more robust and reproducible.

## What shipped

- [`agent.ts`](../../services/runner/src/domains/runs/agent.ts) — Updated `SYSTEM_PROMPT` and `formatDecidePrompt` with dual screenshot/snapshot context guidance, x,y vs id selection criteria, and textfield keyboard handling strategies (tap away, return key, dismiss then tap revealed buttons).
- [`keyboard.ts`](../../services/runner/src/domains/devices/keyboard.ts) — Exported `W3C_RETURN_KEY` (`\uE007`) and updated `w3cKeyActions` to map `\n` and `\r` to the Return keystroke.
- [`keyboard.test.ts`](../../services/runner/src/domains/devices/keyboard.test.ts) — Added unit tests verifying newline and carriage return translation to `W3C_RETURN_KEY`.
- [`agent.test.ts`](../../services/runner/src/domains/runs/agent.test.ts) — Added unit tests verifying dual context prompt instructions, keyboard handling guidelines, and action request mapping for tap away, return key, and newline typing.
- [`case-executor.test.ts`](../../services/runner/src/domains/runs/case-executor.test.ts) — Added end-to-end unit tests verifying multi-step textfield input, keyboard dismissal by tapping away, tapping revealed buttons, and newline input.

## How to verify

1. Run unit tests:
   ```bash
   bun test services/runner/src/domains/runs/agent.test.ts
   bun test services/runner/src/domains/devices/keyboard.test.ts
   bun test services/runner/src/domains/runs/case-executor.test.ts
   ```
2. Run workspace check and lint:
   ```bash
   bun run check
   bun run lint:ci
   ```
3. Run an agent test case in the desktop app with textfields: observe that the agent can decide whether to tap by `id` or `x,y`, dismiss the soft keyboard when needed by tapping neutral space, and tap buttons previously covered by the keyboard.

## Follow-ups

- None.
