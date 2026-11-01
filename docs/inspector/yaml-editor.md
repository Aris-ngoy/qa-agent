# Inspector YAML editor

Spec: [#398](https://github.com/Aris-ngoy/qa-agent/issues/398).

## Goal

The Script panel's YAML tab was a plain textarea: comments, Action names, Branch keywords, keys and values all looked alike, and a problem was reported only as "first: L12 …" under a box with no line numbers. Make it a small code editor for a Case Script file.

## Plan summary

- **CodeMirror 6** (`@codemirror/state`, `view`, `lint`, `commands`). Gutter, error marks, undo and scrolling come built in. Rejected: a coloured layer behind the textarea (scroll/wrap/resize sync and squiggles by hand) and Monaco (far too heavy).
- **Colour by meaning, not by YAML grammar.** A pure function reads the text and tags tokens as `comment`, `action`, `branch`, `key`, `fileKey`, `number`, `string` or `punctuation`. No `@codemirror/lang-yaml`: it cannot tell an Action from any other key.
- Action names come from the runner-client's per-type action schema (minus `branch`, which a Case Script file writes as `- if:`), so a new Action is coloured as soon as it exists. An unknown name (`swpie`) stays a plain key, so a typo stands out.
- Action names and Branch keywords (`if` / `then` / `else`) get different colours: a Branch is not an Action.
- Every parse error with a line is marked on that line (underline, gutter mark, message on hover). The summary line under the editor stays, for errors without a line and for the Steps tab's "Fix in the YAML tab".
- While a script runs the editor is read-only (selectable, copyable) instead of greyed out.

## What shipped

- `features/inspector/utils/script-highlight.ts`: `scriptTokens(text)` (line-by-line, never throws on half-typed YAML; handles block and flow lists, nested Branches, block scalars, quoted strings, URLs with colons) and `scriptDiagnostics(text, errors)`.
- `features/inspector/components/case-script-editor.tsx`: reusable `CaseScriptEditor` (text, onChange, readOnly, errors, onPasteText, ariaLabel). Text stays in `script$.text`; outside changes (Steps tab, Open file, shell paste conversion) are pushed in without echoing back. Keeps the shell-paste handler, vertical resize and spellcheck off.
- The Script panel's YAML tab uses it in place of the textarea.
- New theme-invariant tokens beside `--color-code` in `packages/ui/src/styles.css`: `--color-code-comment`, `-action`, `-branch`, `-key`, `-file-key`, `-number`, `-string`, `-punctuation`, `-gutter`, `-selection`, `-error`.

## How to verify

- `bun test apps/desktop/src/mainview/features/inspector/utils/script-highlight.test.ts`.
- In the app, Inspector → Script → YAML: comments are italic grey, `swipe`/`tap` lavender, `if`/`then`/`else` pink, keys blue, numbers orange, strings green. Rename an action to `swpie`: it turns blue, line gets a wavy underline and a gutter mark, hover shows "unknown action". Paste a `yoqa` shell line: it is converted as before. Run the script: text can be selected but not edited.

## Follow-ups

- Use `CaseScriptEditor` read-only in Run detail and export previews.
- Autocomplete for Action names and fields, Tab-to-indent, folding (out of scope for #398).
