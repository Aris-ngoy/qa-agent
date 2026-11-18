# Auto chat

Status: designed; groundwork built (#463), the screen not yet. Terms: [`CONTEXT.md`](../../CONTEXT.md) → _Auto_ (Auto chat, Case draft, Take over) and _Catalog_ (Test Case). Why the agent is built this way: [ADR 0012](../adr/0012-auto-chat-agent-harness.md).

## Goal

A new **Auto** screen in the desktop side menu where you test by talking: write a prompt, and an agent works out the steps, runs them on the device and shows the result, without you writing each step by hand or babysitting an agent step by step. The chat has to stay fast and light on context, and what it produces must replay afterwards as a plain Case Script, with no agent, through the normal Run.

## Plan summary

**Agent.** The chat agent is the Claude Agent SDK, signed in through the `claude` Provider (CLI login or API key). It plans and talks; the Case executor drives the device whenever a Run executes steps, so the chat sees text summaries of steps and never screenshots. The SDK compacts long chats. Rejected: the Yoqa agent behind a chat UI (cannot diagnose or plan), the SDK acting Action by Action (screenshots fill its context), Codex first (no CLI login yet). See ADR 0012.

**Isolation.** One SDK session per chat, hosted in the runner. Its only tools are Yoqa's, served from an in-process MCP server. All Claude Code built-in tools (Bash, Read, Write, Edit, Web) are off, and no user settings, CLAUDE.md or skills are loaded. Its working directory is a per-chat folder under `~/.yoqa/`.

**Modes gate tools.** Each message has a mode:

| Mode | Tools |
|------|-------|
| Ask | Read the catalog and Runs. No device. |
| Run | Ask, plus write the Case draft and start Runs. |
| Explore | Run, plus read the Screen, act on the device, and propose a new Test Case. |

**A chat and its case.** A chat belongs to one App and works on at most one Test Case, named in the header. It may start with none; accepting a case that Explore proposes sets it. Another case means a new chat. Chats are saved per App with their messages and SDK session id, so they resume; deleted only by the user.

**Case draft, never a direct edit.** The agent writes only a Case draft: changed, added and removed steps, each with instructions and an expected result. A Run of the draft runs those steps, not the saved case.
- Apply needs a Run of the whole draft that passed from a clean start, and applies the whole current draft: its steps and the Case Script that Run learned, together.
- Removing a step from the draft (✕ in the Test tab) clears that pass; the draft must pass again. There is no per-step ✓.
- A Run of a draft does not touch the saved case's Case Script or last result. A passing agent Run of the saved case still saves the Case Script it learned; a Run of a draft hands it back instead (see What shipped).
- Apply keeps one previous version (steps and Case Script); **Restore previous version** in the Test tab swaps them back. No full history.
- Runs from a chat are normal Runs: listed on the Runs page and labelled with their chat.

**Take over.** Pauses the Run and hands the device to the user. Actions taken by hand are not recorded; the agent sees the resulting screen on its next turn. Because Apply needs a clean passing Run, anything done by hand must be reproduced by the draft before it can be saved.

**Step commands.** Each step's command line (e.g. `tap --x 196 --y 488`) comes from the draft Run's own steps, which already know their instruction. The Case Script and the Case Script file format do not change.

**Live updates.** Each chat streams over SSE: text as it is written, tool calls, Run progress. The Run detail page keeps its 1 s poll.

**Model.** One picker in the composer for the chat model (the `claude` Provider's models). Runs use the app's default vision Provider from Settings, shown on the Run card but not changed there.

**Not signed in.** Auto shows an empty state linking to Settings → Providers → Claude. No fallback to another Provider.

**Queue.** Messages sent during a Run queue in order as removable pending bubbles, and go to the agent together as one turn when the Run ends. Esc stops the Run and keeps the queue.

## UI

From the owner's prototype (`AutoB.dc.html`, `AutoBPanels.dc.html`):

- **Side menu:** Auto, between Runs and Inspector, at `/auto`.
- **Header:** chat picker (chat title), **New chat**, platform and device pickers. The device is the one you are connected to; the agent never connects or switches devices. While a Run holds it, the device is view-only.
- **Left, the chat:** your prompts; the agent's replies with linked cards (the case, its last Run); a live Run card with progress, the current step, **Pause** and **Take over**; the composer with Ask / Run / Explore, the model picker and Stop.
- **Right, tabs:**
  - **Device:** the live device through the Inspector's Frame Feed, with the current Action overlaid.
  - **Test:** the Case draft as Changes (unchanged steps collapsed, changed and added steps with before and after) or Full test; **Apply** (enabled once a Run of the whole draft has passed), **Reject all**, **Restore previous version**.
  - **History:** pass rate, average time of passing Runs, duration per Run, a per-step strip per Run, and one note set by a fixed rule (no model call). _Consistent failure_ when the last two or more Runs failed at the same step; _flaky_ when the last five Runs mix passes and failures with no change to the steps between them; no note otherwise.

## Scope

Phase 1 is desktop only, with all three modes. No `yoqa chat` command: external agents already use the CLI and the `yoqa-testing` skill.

## What shipped

The design: this doc, the glossary entries and ADR 0012.

**Runs of a Case draft's steps (#463).** The runner can run a Case draft's steps in place of a Test Case's saved ones: `createDraftRun` in the runs domain takes the case, the draft's steps and an optional Case Script. With a Case Script and a mode that allows it, the Run replays it; otherwise the agent runs the steps, on the browser profile the saved Case Script asks for, and the Case Script it learns asks for that profile too. It is a normal Run (listed, with its steps and screenshots), but it never writes to the catalog: the saved case's Case Script, script-saved time and last result stay as they were, including when the Run errors before its case starts. The caller gets an `outcome` promise that settles when the Run is over, with its status, error and the Case Script a passing agent Run learned. Not exposed over HTTP yet; the Auto chat calls it in-process. A draft with no steps is refused.

## How to verify

The draft Run groundwork: `bun test services/runner/src/domains/runs/draft-run.test.ts` (real catalog in a temp folder, the fake CDP browser, and a fake OpenAI-compatible endpoint as the vision Provider).

Once the screen is built:
1. Sign in the Claude Provider, connect a device, open **Auto**.
2. Ask mode: "Why did the last run of #8 fail?" The agent answers from Runs and does not touch the device.
3. Run mode: "Fix #8 so it passes." The Test tab fills with a Case draft and a Run of the draft appears on the Runs page; #8's saved Case Script is unchanged.
4. Remove one draft step: Apply turns off until the draft passes again. Apply, then replay #8 with `yoqa script run` (or a script-mode Run): it passes with no Provider call.
5. **Restore previous version** brings back the old steps and Case Script.

## Follow-ups

- Compare two Runs from the History tab.
- Codex as a second harness once the `codex` Provider supports a CLI login.
- Recording Take over Actions into the draft, if reproducing them by hand turns out to be painful.
