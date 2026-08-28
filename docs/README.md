# Docs

Build notes and feature write-ups produced after **plan → build** work.

**Public product docs (Mintlify):** [`apps/docs`](../apps/docs) — run `bun run docs` (preview at http://localhost:3000). Hosted target: `https://docs.yoqa.ai`.

| Folder | Use for |
|--------|---------|
| `architecture/` | Cross-cutting design and system layout |
| `adr/` | Architecture Decision Records (short why) |
| `sessions/` | Dated one-off build logs (`YYYY-MM-DD-slug.md`) |
| `<area>/` | Durable docs for a domain (e.g. `providers/`, `runner/`, `desktop/`, `runs/`) |

Domain glossary: [`CONTEXT.md`](../CONTEXT.md). See `.cursor/rules/document-plan-builds.mdc` for when and how agents should add entries.

## Index

| Doc | Topic |
|-----|--------|
| [architecture/current-layout.md](./architecture/current-layout.md) | Runner domain layout + config stores |
| [architecture/deepening.md](./architecture/deepening.md) | Device Session / Provider / Case executor deepen |
| [architecture/deepen-phases-3-5.md](./architecture/deepen-phases-3-5.md) | Provider catalog, case executor, script parse unify |
| [adr/0001-device-session-ownership.md](./adr/0001-device-session-ownership.md) | Device Session under `devices/`, exclusive per device |
| [adr/0002-provider-vision-capability.md](./adr/0002-provider-vision-capability.md) | Provider adapters + runner catalog |
| [adr/0003-case-executor-test-seam.md](./adr/0003-case-executor-test-seam.md) | Case executor as Run test seam |
| [runs/selection-and-runs-mvp.md](./runs/selection-and-runs-mvp.md) | Test case selection + local `POST /runs` MVP |
| [runs/ai-sdk-vision.md](./runs/ai-sdk-vision.md) | Vision decide + grounding via Vercel AI SDK |
| [runs/cursor-vision-cli.md](./runs/cursor-vision-cli.md) | Cursor Agent CLI vision decide + grounding |
| [runs/run-ui-and-cancel.md](./runs/run-ui-and-cancel.md) | Run list + detail, play→cancel, cancel/delete APIs |
| [runs/run-detail-thoughts.md](./runs/run-detail-thoughts.md) | Case/device labels + per-step expandable AI thoughts |
| [providers/opencode-model-selection.md](./providers/opencode-model-selection.md) | OpenCode Free/Paid model picker + free default |
| [providers/ai-sdk-settings-providers.md](./providers/ai-sdk-settings-providers.md) | Groq / Google / Vertex / Antigravity + Codex vision |
| [providers/cursor-grok-custom-settings.md](./providers/cursor-grok-custom-settings.md) | Cursor Agent, xAI Grok, Custom OpenAI-compatible |
| [cli/npm-publish.md](./cli/npm-publish.md) | Public `@yoqa/cli` npm package + release workflow |
| [cli/github-actions.md](./cli/github-actions.md) | `yoqa report` + composite actions for GitHub Actions HTML reports |
| [cli/github-actions-expo.md](./cli/github-actions-expo.md) | Expo demo app + GitHub Actions device smoke for `@yoqa/cli` |
| [cli/expo-e2e-catalog-report.md](./cli/expo-e2e-catalog-report.md) | Catalog script smoke + HTML artifacts + iOS WDA timeout |
| [cli/headless-runner.md](./cli/headless-runner.md) | Headless `yoqa serve` / auto-start for CI |
| [desktop/cli-and-agents.md](./desktop/cli-and-agents.md) | Settings CLI/skill install + full `yoqa` agent CLI |
| [desktop/servers-and-doctor.md](./desktop/servers-and-doctor.md) | Servers panel + `yoqa doctor` diagnostics |
| [desktop/manual-inspector.md](./desktop/manual-inspector.md) | Script-first Manual Inspector (select → shell script → run) |
| [desktop/motion-system.md](./desktop/motion-system.md) | CSS View Transitions + shell/list motion polish |
| [desktop/react-hook-form.md](./desktop/react-hook-form.md) | RHF + HeroUI form helpers for all data-entry forms |
| [desktop/error-toast.md](./desktop/error-toast.md) | HeroUI danger toasts with summarized run errors |
| [runs/wda-rebuild-skip.md](./runs/wda-rebuild-skip.md) | Runs panel Skip/Rebuild → iOS WDA `--force` |
| [runs/vision-no-screenshot-fail.md](./runs/vision-no-screenshot-fail.md) | Harden agent against “no screenshot” hallucinations |
| [runs/android-permission-alerts.md](./runs/android-permission-alerts.md) | Android Allow / permission dialog taps and agent alerts |
| [devices/xml-entity-labels.md](./devices/xml-entity-labels.md) | Decode `&amp;` in screen labels so tap-by-label matches |
| [runs/saved-scripts.md](./runs/saved-scripts.md) | Save script after pass; script vs AI run prompt |
| [runs/report-export.md](./runs/report-export.md) | HTML/Markdown E2E report export (runs + inspector) |
| [ios/wda-reuse-on-select.md](./ios/wda-reuse-on-select.md) | Skip/rebuild WebDriverAgent on physical iOS select |
| [sessions/2026-07-24-yoqa-testing-skill.md](./sessions/2026-07-24-yoqa-testing-skill.md) | Copied/rebranded `yoqa-testing` agent skill |
| [sessions/2026-07-27-mintlify-docs-site.md](./sessions/2026-07-27-mintlify-docs-site.md) | Public Mintlify docs site at `apps/docs` |
