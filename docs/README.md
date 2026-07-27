# Docs

Build notes and feature write-ups produced after **plan → build** work.

| Folder | Use for |
|--------|---------|
| `architecture/` | Cross-cutting design and system decisions |
| `sessions/` | Dated one-off build logs (`YYYY-MM-DD-slug.md`) |
| `<area>/` | Durable docs for a domain (e.g. `providers/`, `runner/`, `desktop/`, `runs/`) |

See `.cursor/rules/document-plan-builds.mdc` for when and how agents should add entries.

## Index

| Doc | Topic |
|-----|--------|
| [runs/selection-and-runs-mvp.md](./runs/selection-and-runs-mvp.md) | Test case selection + local `POST /runs` MVP |
| [runs/ai-sdk-vision.md](./runs/ai-sdk-vision.md) | Vision decide + grounding via Vercel AI SDK |
| [runs/cursor-vision-cli.md](./runs/cursor-vision-cli.md) | Cursor Agent CLI vision decide + grounding |
| [runs/run-ui-and-cancel.md](./runs/run-ui-and-cancel.md) | Run list + detail, play→cancel, cancel/delete APIs |
| [runs/run-detail-thoughts.md](./runs/run-detail-thoughts.md) | Case/device labels + per-step expandable AI thoughts |
| [providers/opencode-model-selection.md](./providers/opencode-model-selection.md) | OpenCode Free/Paid model picker + free default |
| [providers/ai-sdk-settings-providers.md](./providers/ai-sdk-settings-providers.md) | Groq / Google / Vertex / Antigravity + Codex vision |
| [providers/cursor-grok-custom-settings.md](./providers/cursor-grok-custom-settings.md) | Cursor Agent, xAI Grok, Custom OpenAI-compatible |
| [desktop/cli-and-agents.md](./desktop/cli-and-agents.md) | Settings CLI/skill install + full `yoqa` agent CLI |
| [desktop/manual-inspector.md](./desktop/manual-inspector.md) | Script-first Manual Inspector (select → shell script → run) |
| [desktop/motion-system.md](./desktop/motion-system.md) | CSS View Transitions + shell/list motion polish |
| [desktop/react-hook-form.md](./desktop/react-hook-form.md) | RHF + HeroUI form helpers for all data-entry forms |
| [desktop/error-toast.md](./desktop/error-toast.md) | HeroUI danger toasts with summarized run errors |
| [runs/wda-rebuild-skip.md](./runs/wda-rebuild-skip.md) | Runs panel Skip/Rebuild → iOS WDA `--force` |
| [runs/vision-no-screenshot-fail.md](./runs/vision-no-screenshot-fail.md) | Harden agent against “no screenshot” hallucinations |
| [runs/saved-scripts.md](./runs/saved-scripts.md) | Save script after pass; script vs AI run prompt |
| [ios/wda-reuse-on-select.md](./ios/wda-reuse-on-select.md) | Skip/rebuild WebDriverAgent on physical iOS select |
| [sessions/2026-07-24-yoqa-testing-skill.md](./sessions/2026-07-24-yoqa-testing-skill.md) | Copied/rebranded `yoqa-testing` agent skill |
