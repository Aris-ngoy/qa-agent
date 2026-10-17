# Web in the skill and the public docs

## Goal

Coding agents and users can learn web support from the docs: the `yoqa-testing` skill and the public Mintlify site cover **Browser devices** (installed browsers, and attach by port with its non-default-profile requirement), **Viewport presets**, the App's **Web URL**, what each **Action** means on web, and the `key` Action on every platform. Ticket [#312](https://github.com/Aris-ngoy/qa-agent/issues/312), part of web support ([#301](https://github.com/Aris-ngoy/qa-agent/issues/301)). Vocabulary: [`CONTEXT.md`](../../CONTEXT.md).

## Plan summary

- **Web is woven into the existing skill files, not a separate one.** An agent reaches web through the same connect → screenshot → act → verify loop, so the devices reference, the inspect/app-control reference, the coordinates reference, the run reference and the debug workflow each gain their web part, and the debug workflow gains a worked web example (connect at `--viewport mobile`, `open-url`, `input`, `key Tab`, `key Enter`, `assert`). Rejected: a `references/web.md` the loop never links to.
- **`key` lives in the inspect/app-control reference** with a per-platform table (web and Android all keys with modifiers, the iOS simulator all keys without, the cabled iPhone Enter/Backspace/Space), and the rule that an undeclared key fails rather than retrying it.
- **One public page, `docs/web`,** in the Docs tab's Testing group, plus web rows in the CLI reference (`devices web`, a connect options table with `--viewport`, attach by `chromium-cdp-<port>`, `action key`, `apps … --web-url`, `runs create --device web-chrome`), the Apps identifiers table, Device Preparation, Overview, and the agent guide.
- **Guarded by tests, not by review.** `skill-docs.test.ts` already checked every `yoqa …` line in the skill against the commander tree. It now runs the same checks on `apps/docs`, requires both to document `devices web`, a `web-chrome` and a `chromium-cdp-<port>` connect, `--viewport mobile`, `--web-url`, and `action key` with and without `--modifiers`, and fails on any "Appium" in the skill or the public Docs tab (ADR-0005).
- **The repo's local skill copy (`.agents/skills/yoqa-testing`) is synced** to the shipped one and a test keeps them identical. It had drifted and still told agents to run `yoqa runtime ensure` for an Appium runtime.
- The stale Appium and WDA lines in the Local testing guide and Device Preparation are reworded. The Introduction's mention of Appium as an example of a script-based tool stays; it names a competitor, not a Lane.

## What shipped

- **Skill** (`packages/skill/yoqa-testing`, mirrored in `.agents/skills/yoqa-testing`):
  - `SKILL.md`: description and intro name web; conventions for `key` and the web platform.
  - `references/devices.md`: `devices web`, the Yoqa-owned window and throwaway profile, the presets table, `--viewport`, attach by port with Chrome 136+'s non-default `--user-data-dir`.
  - `references/inspect-and-app-control.md`: the web Screen (accessibility tree, `data-testid` then `id`), lifecycle on the Web URL, `background-app` unsupported, popups followed, `alert` on JavaScript dialogs, and a Keys section.
  - `references/actions-coordinates.md`: viewport-relative coordinates, swipe as wheel scroll or touch stroke by preset, newline-presses-Enter in `input`.
  - `references/run.md`: a web Run opens the Web URL, fails fast without one, has no builds or video, and uses `desktop` unless connected first.
  - `workflows/debug-on-device.md`: connecting a browser, opening the URL instead of installing, and a worked web loop.
- **Public docs** (`apps/docs`): new `docs/web.mdx` (devices, presets, attach, Web URL, Action table, `key`, worked example, limits), and web additions to `cli.mdx`, `apps.mdx`, `device-preparation.mdx`, `overview.mdx`, `guide/cli-for-agents.mdx`, `guide/local-testing.mdx` and the site description in `docs.json`.
- **Tests** (`packages/cli/src/skill-docs.test.ts`): CLI-drift checks for the public docs, the web coverage check for both, the Appium check, and the local-copy check.

## How to verify

```bash
bun test packages/cli/src/skill-docs.test.ts
bun run lint:ci && bun run test && bun run check
```

Preview the site (`cd apps/docs && bun install`, then `bun run docs` from the repo root) and open `/docs/web` and `/docs/cli`: the Web page is in the Testing group, and the CLI's Devices section has the connect options table.

## Follow-ups

- When browsers reach the desktop device picker and Runs panel ([#311](https://github.com/Aris-ngoy/qa-agent/issues/311)), drop "connect from the CLI" from the Web page's limits and describe the desktop flow.
- `runs create` has no `--viewport`; the docs tell users to connect first. Update them if it gains one.
