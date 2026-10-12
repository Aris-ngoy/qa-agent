# Docs

Build notes and feature write-ups produced after **plan → build** work.

**Public product docs (Mintlify):** [`apps/docs`](../apps/docs) — run `bun run docs` (preview at http://localhost:3000). Hosted target: `https://yoqa.arisn.dev`.

| Folder | Use for |
|--------|---------|
| `architecture/` | Cross-cutting design and system layout |
| `adr/` | Architecture Decision Records (short why) |
| `sessions/` | Dated one-off build logs (`YYYY-MM-DD-slug.md`) |
| `<area>/` | Durable docs for a domain (e.g. `providers/`, `runner/`, `desktop/`, `runs/`) |

Domain glossary: [`CONTEXT.md`](../CONTEXT.md). See [AGENTS.md](../AGENTS.md) for when and how agents should add entries, and for the contribution gates (PR-only `main`, required checks, owner bypass).

## Index

| Doc | Topic |
|-----|--------|
| [architecture/current-layout.md](./architecture/current-layout.md) | Runner domain layout + config stores |
| [architecture/deepening.md](./architecture/deepening.md) | Device Session / Provider / Case executor deepen |
| [architecture/deepen-phases-3-5.md](./architecture/deepen-phases-3-5.md) | Provider catalog, case executor, script parse unify |
| [adr/0001-device-session-ownership.md](./adr/0001-device-session-ownership.md) | Device Session under `devices/`, exclusive per device |
| [adr/0002-provider-vision-capability.md](./adr/0002-provider-vision-capability.md) | Provider adapters + runner catalog |
| [adr/0003-case-executor-test-seam.md](./adr/0003-case-executor-test-seam.md) | Case executor as Run test seam |
| [adr/0006-case-script-file-yaml.md](./adr/0006-case-script-file-yaml.md) | A Case Script file is YAML; no separate Flow model |
| [runs/selection-and-runs-mvp.md](./runs/selection-and-runs-mvp.md) | Test case selection + local `POST /runs` MVP |
| [runs/ai-sdk-vision.md](./runs/ai-sdk-vision.md) | Vision decide + grounding via Vercel AI SDK |
| [runs/cursor-vision-cli.md](./runs/cursor-vision-cli.md) | Cursor Agent CLI vision decide + grounding |
| [runs/run-ui-and-cancel.md](./runs/run-ui-and-cancel.md) | Run list + detail, play→cancel, cancel/delete APIs |
| [runs/runs-list-layout.md](./runs/runs-list-layout.md) | Runs list: status dot, result chip, Passed / Failed filters |
| [runs/run-details-layout.md](./runs/run-details-layout.md) | Run details: status chip, device meta line, numbered steps, phone screenshot |
| [runs/run-detail-thoughts.md](./runs/run-detail-thoughts.md) | Case/device labels + per-step expandable AI thoughts |
| [providers/opencode-model-selection.md](./providers/opencode-model-selection.md) | OpenCode Free/Paid model picker + free default |
| [providers/ai-sdk-settings-providers.md](./providers/ai-sdk-settings-providers.md) | Groq / Google / Vertex / Antigravity + Codex vision |
| [providers/cursor-grok-custom-settings.md](./providers/cursor-grok-custom-settings.md) | Cursor Agent, xAI Grok, Custom OpenAI-compatible |
| [providers/groq-action-family-parity.md](./providers/groq-action-family-parity.md) | Groq decide compatibility + Action-family parity at the vision seam |
| [providers/prompt-cache.md](./providers/prompt-cache.md) | Prompt cache-friendly Decide/verify order, Anthropic breakpoints, per-step Call usage |
| [cli/npm-publish.md](./cli/npm-publish.md) | Public `@yoqa/cli` npm package + release workflow |
| [cli/github-actions.md](./cli/github-actions.md) | `yoqa report` + composite actions for GitHub Actions HTML reports |
| [cli/github-actions-expo.md](./cli/github-actions-expo.md) | Expo demo app + GitHub Actions device smoke for `@yoqa/cli` |
| [cli/expo-e2e-catalog-report.md](./cli/expo-e2e-catalog-report.md) | Catalog script smoke + HTML artifacts + iOS WDA timeout |
| [cli/headless-runner.md](./cli/headless-runner.md) | Headless `yoqa serve` / auto-start for CI |
| [desktop/cli-and-agents.md](./desktop/cli-and-agents.md) | Settings CLI/skill install + full `yoqa` agent CLI |
| [desktop/servers-and-doctor.md](./desktop/servers-and-doctor.md) | Servers panel + `yoqa doctor` diagnostics |
| [desktop/manual-inspector.md](./desktop/manual-inspector.md) | Script-first Manual Inspector (select → Case Script file → run) |
| [runs/case-script-yaml.md](./runs/case-script-yaml.md) | Case Script files: YAML default import/export, `yoqa script validate/run/export`, shared replay |
| [desktop/inspector-manual-connect.md](./desktop/inspector-manual-connect.md) | Inspector attaches only on Connect; flicker-free frames; React Compiler + Legend State feed store |
| [inspector/legend-state.md](./inspector/legend-state.md) | Inspector folder layout: components, runner API, Legend-State atoms, query hooks, utils |
| [desktop/session-bar.md](./desktop/session-bar.md) | Top bar manages the shared Active Session on every page: connect-first Run, Run chip, WDA rebuild on Restart, app switch retargets |
| [desktop/motion-system.md](./desktop/motion-system.md) | CSS View Transitions + shell/list motion polish |
| [desktop/react-hook-form.md](./desktop/react-hook-form.md) | RHF + HeroUI form helpers for all data-entry forms |
| [desktop/error-toast.md](./desktop/error-toast.md) | HeroUI danger toasts with summarized run errors |
| [desktop/ui-preferences.md](./desktop/ui-preferences.md) | Storage-backed theme mode + sidebar-collapsed preferences module |
| [desktop/dark-theme.md](./desktop/dark-theme.md) | Dark theme: data-theme tokens, pre-paint script, Settings → Appearance |
| [desktop/collapsible-side-menu.md](./desktop/collapsible-side-menu.md) | Side menu collapses to an icon rail via top-bar toggle or ⌘B |
| [desktop/list-pagination.md](./desktop/list-pagination.md) | Runs and Test cases lists paged client-side, 20 rows by default (20/50/100) |
| [desktop/dark-mode-coverage.md](./desktop/dark-mode-coverage.md) | Hardcoded colors migrated to tokens + a guard test |
| [desktop/theme-and-collapsible-sidebar.md](./desktop/theme-and-collapsible-sidebar.md) | Dark sidebar card styling + overview of the theme/side-menu feature set |
| [runs/wda-rebuild-skip.md](./runs/wda-rebuild-skip.md) | Runs panel Skip/Rebuild → iOS WDA `--force` |
| [runs/vision-no-screenshot-fail.md](./runs/vision-no-screenshot-fail.md) | Harden agent against “no screenshot” hallucinations |
| [runs/vision-first-screen-mode.md](./runs/vision-first-screen-mode.md) | Run agent decides from the screenshot and `x,y`; tree is opt-in (`screenMode`) |
| [runs/game-tap-grid.md](./runs/game-tap-grid.md) | Coordinate grid so game taps use the screenshot point |
| [runs/run-recording.md](./runs/run-recording.md) | Opt-in per-Test-Case screen video, shown after the Run finishes |
| [runs/action-result-screenshot.md](./runs/action-result-screenshot.md) | `yoqa action --screenshot`: settle, result screenshot, tap marker for games |
| [runs/android-permission-alerts.md](./runs/android-permission-alerts.md) | Android Allow / permission dialog taps and agent alerts |
| [devices/xml-entity-labels.md](./devices/xml-entity-labels.md) | Decode `&amp;` in screen labels so tap-by-label matches |
| [devices/text-input.md](./devices/text-input.md) | WDA-safe typing via `mobile: type` + paired keyDown/keyUp |
| [devices/device-session-lane-seam.md](./devices/device-session-lane-seam.md) | `DeviceSession` is a lane-neutral interface; Appium is one Lane behind it |
| [devices/connector-speed.md](./devices/connector-speed.md) | Lane selection, Agent image, `yoqa action batch` |
| [devices/benchmark.md](./devices/benchmark.md) | Yoqa vs Argent latency + accuracy harness |
| [devices/appium-lane-wins.md](./devices/appium-lane-wins.md) | Adaptive Settle, cached window size, connector phases |
| [devices/android-direct-lane.md](./devices/android-direct-lane.md) | Android Direct lane over adb |
| [devices/device-lanes-foundation.md](./devices/device-lanes-foundation.md) | Lane contract suite, capability-pinned adoption, Direct implementations, wired iPhones |
| [devices/no-appium-acquire.md](./devices/no-appium-acquire.md) | Session acquire never opens the Appium lane: Direct, or the connect fails |
| [catalog/no-appium-capabilities.md](./catalog/no-appium-capabilities.md) | Apps and Cases no longer carry Appium capabilities |
| [devices/remove-appium-lane.md](./devices/remove-appium-lane.md) | The Appium lane, server, and runtime are removed: a Lane is Direct only ([ADR-0005](./adr/0005-direct-only-lane.md)) |
| [devices/android-latest-frame.md](./devices/android-latest-frame.md) | `device-android`: capture-frame from a background `screencap` loop (opt-in) |
| [devices/ios-sim-promotion.md](./devices/ios-sim-promotion.md) | `device-sim` (yoqa-sim + yoqa-ax) is the iOS-simulator Direct default, benchmarked against idb_companion |
| [devices/yoqa-ax-alerts.md](./devices/yoqa-ax-alerts.md) | `yoqa-ax` reads SpringBoard dialogs; accept and dismiss tap them through `yoqa-sim` (default since #245) |
| [devices/yoqa-runner-status.md](./devices/yoqa-runner-status.md) | `YoqaRunner` (physical iOS): XCUITest runner signs with the newest Apple Development team, builds once per source/Xcode/team, answers `status` on the phone |
| [devices/ios-signing-team.md](./devices/ios-signing-team.md) | The physical-iOS signing team is one runner setting: `yoqa signing` / Settings › iOS choose it, `yoqa signing check` / **Check** sign for a cabled iPhone; `YOQA_IOS_TEAM_ID` still wins |
| [devices/ios-device-usbmux.md](./devices/ios-device-usbmux.md) | `device-ios`: an explicit `direct` request on a cabled iPhone reaches `YoqaRunner` over usbmuxd; `status` must cross the cable first; `auto` picks it (promoted in #251) |
| [devices/inspector-session.md](./devices/inspector-session.md) | Cabled iPhone: frame and tree reads use their own link and do not end the Device Session |
| [devices/ios-device-actions.md](./devices/ios-device-actions.md) | `device-ios`: tap, long-press, drag and screenshot over `YoqaRunner`; gestures journaled (64), a lost reply resolved by `status`, never resent |
| [devices/ios-device-observation.md](./devices/ios-device-observation.md) | `device-ios`: the Screen tree, typing and hardware buttons; `APP_BACKGROUNDED` and `RUNNER_WEDGED` (the main-thread gate) |
| [devices/ios-device-benchmark.md](./devices/ios-device-benchmark.md) | `device-ios` vs Appium on a cabled iPhone: about 2.4x faster per tap once the snapshot is one read; promoted: `auto` picks it |
| [devices/ios-device-default.md](./devices/ios-device-default.md) | `device-ios` becomes the `auto` lane on a cabled iPhone; the `directIsAutomatic` gate is removed |
| [devices/yoqa-ax-describe.md](./devices/yoqa-ax-describe.md) | `yoqa-ax` reads the accessibility tree inside the simulator; the Screen comes from it, cached by frame hash (default since #245) |
| [devices/yoqa-ax-connect.md](./devices/yoqa-ax-connect.md) | `yoqa-ax` runs inside the simulator and connects back to the runner over a Unix socket; `ping` (default since #245) |
| [devices/yoqa-sim-framebuffer-hid.md](./devices/yoqa-sim-framebuffer-hid.md) | `yoqa-sim` reads the framebuffer and sends Indigo HID touches: tap, swipe, Home (default since #245) |
| [devices/yoqa-sim-spawn.md](./devices/yoqa-sim-spawn.md) | `device-sim`: the resident `yoqa-sim` process, spawned per simulator, serving screenshots (default since #245) |
| [devices/yoqa-sim-stream.md](./devices/yoqa-sim-stream.md) | `yoqa-sim` serves an MJPEG live stream that the Inspector shows through `/stream.mjpeg` (default since #245) |
| [devices/android-instrumentation-tree.md](./devices/android-instrumentation-tree.md) | `device-android`: Screen from the `yoqa.android.devtools` helper, `uiautomator dump` fallback (opt-in) |
| [devices/runner-app-icons.md](./devices/runner-app-icons.md) | `YoqaRunnerUITests-Runner` (re-signed after build), `YoqaRunner` and the Android devtools helper carry the Yoqa logo from `bun run icons` |
| [devices/android-direct-tree-settle.md](./devices/android-direct-tree-settle.md) | Direct system-wide tree, Settle, vs-Argent gate |
| [devices/hybrid-screen-arm.md](./devices/hybrid-screen-arm.md) | Screenshot + tree every Agent step as a benchmark arm |
| [devices/idb-companion-spike.md](./devices/idb-companion-spike.md) | idb_companion vs WDA on one simulator; adopt for iOS Direct |
| [devices/ios-direct-lane.md](./devices/ios-direct-lane.md) | iOS-simulator Direct lane over idb_companion |
| [devices/ios-direct-tree-settle.md](./devices/ios-direct-tree-settle.md) | iOS Direct axbridge Screen, system modal, Settle |
| [runs/saved-scripts.md](./runs/saved-scripts.md) | Save script after pass; script vs AI run prompt |
| [runs/report-export.md](./runs/report-export.md) | HTML/Markdown E2E report export (runs + inspector) |
| [runs/agent-step-latency-and-knowledge.md](./runs/agent-step-latency-and-knowledge.md) | Decide latency, per-phase step timing, App Knowledge, retention |
| [ios/wda-reuse-on-select.md](./ios/wda-reuse-on-select.md) | Skip/rebuild WebDriverAgent on physical iOS select |
| [sessions/2026-07-24-yoqa-testing-skill.md](./sessions/2026-07-24-yoqa-testing-skill.md) | Copied/rebranded `yoqa-testing` agent skill |
| [sessions/2026-07-27-mintlify-docs-site.md](./sessions/2026-07-27-mintlify-docs-site.md) | Public Mintlify docs site at `apps/docs` |
| [sessions/2026-09-25-android-emulator-sdk-setup.md](./sessions/2026-09-25-android-emulator-sdk-setup.md) | Android E2E `tools` package fix; job was never green |
| [sessions/2026-10-11-runner-tunnel-retry.md](./sessions/2026-10-11-runner-tunnel-retry.md) | iPhone tunnel retry, Unreachable Session (503) and Frame Feed (`streamState`) |
