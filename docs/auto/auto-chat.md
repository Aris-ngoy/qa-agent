# Auto chat

Status: Ask mode built (#463, #455); Run mode writes the Case draft (#456) and runs it (#457), and the Test tab applies, trims, rejects and restores it (#458); Explore not yet. Terms: [`CONTEXT.md`](../../CONTEXT.md) → _Auto_ (Auto chat, Case draft, Take over) and _Catalog_ (Test Case). Why the agent is built this way: [ADR 0012](../adr/0012-auto-chat-agent-harness.md).

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

**Case draft, never a direct edit.** The agent writes only a Case draft: changed, added and removed steps, each with instructions and an expected result. A Run of the draft runs those steps, not the saved case. Draft steps keep their saved step's id, so changes are shown exactly; rejected: diffing by position or text (a moved or reworded step would show as removed plus added). Reading the draft (`get_case_draft`) is allowed in every mode, since it changes nothing; writing it needs Run.
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

**The Auto screen and Ask chat (#455).** In the runner (`domains/auto`):
- **Chats** are saved per App in `auto_chats` and `auto_messages` (each message with its mode, the reply's text, its tool calls and any error), with the SDK session id, so the next message resumes the session. A chat's title is its first message. Deleting a chat deletes its messages and its working folder, and stops a reply being written.
- **Routes**: `GET /auto/status`, `GET /auto/models`, `GET|POST /apps/:appId/auto/chats`, `GET|PATCH|DELETE /auto/chats/:id`, `POST /auto/chats/:id/messages` (202: the prompt is saved, the reply streams) and `GET /auto/chats/:id/events`, the chat's SSE stream (`message`, `text`, `tool_call`, `tool_result`, `chat`). The contract is `packages/runner-client/src/auto.ts`. `GET /auto/chats/:id` carries the reply being written, so a screen opened mid-reply can show it. One reply at a time (409 while one is written); Run and Explore answer 400 until their tickets.
- **The chat agent** sits behind a small port (`ChatAgent`: status, models, one turn). The production adapter runs the Claude Agent SDK (pinned `0.3.317`), signed in through the enabled Claude Provider (API key, or the Claude CLI login; never another Provider). Each turn has no built-in tools (`tools: []`), no setting sources, a strict MCP config with only the in-process `yoqa` server, `permissionMode: "dontAsk"` with only the mode's tools allowed, Yoqa's own system prompt, the chat's model, and the chat's working folder under `~/.yoqa/auto-chats/<chat>/` (`YOQA_AUTO_CHATS_DIR` moves it). Streamed text becomes `text` events, and a new text block starts a new paragraph.
- **Ask tools**, answering in text: `get_test_case` (steps, Case Script, last result), `list_runs` and `get_run` (each case's steps, with what each did and why it failed), and `set_test_case`, which sets the chat's Test Case once, while it has none. A tool the mode does not allow is refused by the runner, whatever the agent asks.
- A chat's Test Case comes from **Chat about this case** (`POST …/chats` with `caseId`), or from `set_test_case`. Setting it is one conditional write, so of two attempts at once only one wins.
- The next message waits until the reply before it is saved, so prompts and replies never interleave. Deleting a chat ends its open SSE streams.

In the desktop (`features/auto`):
- **Auto** in the side menu, at `/auto?chat=<id>`, on the selected App. With the Claude Provider signed out it shows an empty state linking to Settings → Providers → Claude.
- **Header:** the chat picker and **New chat**, with the chat's Test Case. The platform and device pickers are the app's top bar, which every screen already shows; Auto adds none of its own.
- **Chat:** the messages, the reply streaming with its tool calls, and the composer with the mode (Explore shown but off until its ticket) and the model picker.
- **Right:** the Device tab shows the connected device's live frames through the Inspector's Frame Feed, view only. History is a placeholder until its ticket.
- **Chat about this case** on a Test Case opens a new chat on it, and selects the case's App.
- The SSE stream has no replay: each time it (re)connects, the screen fetches the chat again, which carries the saved messages and the reply being written. A stream the browser gives up on is opened again while the chat still loads.

**The Case draft (#456).** Run mode answers now, with the Ask tools plus the Case draft's:
- **Draft tools:** `set_draft_steps` (the whole draft at once; a step may name the saved step it rewrites with `savedStep`, and give its own reason), `add_draft_step`, `change_draft_step` and `remove_draft_step`, each with a short reason, and each answering the whole draft as numbered text. `get_case_draft` reads it in any mode. They need the chat's Test Case; Ask refuses the write tools.
- **The draft** (`CaseDraft` in the client contract) is saved per chat in `auto_case_drafts`, gone with the chat or its Test Case. It holds the case's steps when the draft started (`base`), the whole draft in order (`steps`, each with the reason it was changed or added, null while it is as saved) and the saved steps it leaves out (`removed`, with their reasons). A draft step keeps the id of the saved step it came from (added steps get catalog-style `cf_` ids), so before and after are exact. A step as saved is unchanged while it keeps its saved order; one taken out of it (outside the longest stretch of steps still in saved order) is moved, with a reason. A step changed back to its saved text, or a removed step added back as saved, is that step again. A changed step drops its link to a reusable Flow. The catalog is never written.
- Each edit is pushed as a `draft` event, and `GET /auto/chats/:id` carries the draft, so a resumed chat shows it.
- **Test tab:** **Changes** shows changed, moved, added and removed steps (a removed step where it was in the saved case), each with before and after and its reason, and collapses stretches of unchanged steps ("Steps 1–2 unchanged"). **Full test** shows the whole draft in order.

**Running the Case draft (#457).** Run mode adds `run_case_draft` (Ask refuses it):
- It runs the whole draft, from the App's start, on the device the top bar is connected to (its viewport on web), as a Run of the draft's steps (#463): the agent drives it, or the draft's own Case Script replays (executionMode `auto`). It refuses with no device, a device another Run holds, or no draft yet. The tool waits for the Run to end and answers the Run as text (`describeRun`: each step with what it did and its command line, never a screenshot), plus whether it is now the draft's passing Run.
- **Passing Run.** The draft gains `passingRunId` and `learnedScript`. A passed Run of a draft unchanged since it started (same `updatedAt`) sets both: the Case Script the Run learned, or the draft's own it replayed. Every change to the draft clears both, so the draft must pass again. A Run of the draft never writes the saved case (#463). "A clean start" here means the whole draft from the App's start target; Take over (#459) will be the first thing that makes a Run not clean.
- **Which step a Run step is of.** Run steps did not record it, so the Case executor now stamps each agent step's action with `flowStep` (the step of the case, from 0, its instruction came from; the Case Script and its file format are unchanged). The Run card's current step is the last Run step's, or the next once that step's verify accepted the last instruction its step splits into. A replayed Case Script does not say which step each Action is of, so the card lists its commands apart (`replayed`).
- **Run card over SSE.** While the tool waits, the runner reads the Run again every 250 ms and pushes a `run` event (`AutoRun` in the client contract) when it changed, and once more when it ends: status, how it runs, the vision Provider (label and model, the app default; none when replaying), start and end times, the current step and command, and each draft step with its status (pending, running, passed, failed, stopped) and command lines. `GET /auto/chats/:id` carries the Run in progress as `run`. Rejected: hooking progress callbacks into every place the runs domain writes a step or status (several, and easy to miss one); the Run detail page keeps its own 1 s poll.
- **One at a time.** A chat runs one draft Run at a time: a second `run_case_draft` while one is starting or running (the agent may call tools in parallel) is refused. A Run deleted from the Runs page before it ends answers that it was deleted.
- **Stop.** `POST /auto/chats/:id/run/stop` (409 when no Run is in progress) cancels through the Run's own cancel; deleting the chat stops its Run too. The agent's answer says the Run was stopped.
- **Runs page.** A Run stores the chat that started it (`runs.auto_chat_id`, set null when the chat is deleted), and every Run read carries `autoChat` (`{ id, title }`). The Runs page labels such a Run "Auto · <chat title>"; its detail page is the usual one.

**Apply, ✕, Reject all, Restore previous version (#458).**
- **Apply** (`POST /auto/chats/:id/draft/apply`) saves the whole draft to the Test Case: its steps (keeping their ids; a step still linked to a reusable Flow keeps its `flowId`) and the Case Script its passing Run learned, in one transaction with deleting the draft. It answers 409 with the reason, and changes nothing, when the chat has no draft, when the draft has no passing Run, when that Run learned no Case Script (it took no Actions, so the case could not replay), or when the Test Case's steps are no longer the draft's `base`: added, removed, reordered, relinked, or a step's own text edited in Test Cases meanwhile, or restored. Applying would undo that edit, so the user rejects and asks again. Editing a reusable Flow's text is not such an edit: the applied step stays linked to the Flow. Rejected: rebasing the draft onto the edited case (the passing Run was of the old one). The case's last result is left as it was.
- **Recording the pass** is now one transaction too: a passed Run becomes the draft's passing Run only if the draft is still the one that ran, so a ✕ or Reject all that lands as the Run ends is never undone.
- **Previous version.** Apply keeps the steps and Case Script it replaces (`case_previous_versions`, one row per Test Case, the raw Case Script JSON and its saved time). `POST /auto/chats/:id/previous-version/restore` swaps the current and previous versions, so restoring twice returns to the applied one; 409 when there is none. A restored step whose reusable Flow was deleted meanwhile keeps its own text.
- **✕** (`DELETE /auto/chats/:id/draft/steps/:stepId`) removes a step by id, with the reason "Removed in the Test tab", and like any change clears the passing Run and its Case Script. **Reject all** is `DELETE /auto/chats/:id/draft`; the Test Case is untouched. Both 404 when there is no draft (or no such step).
- `GET /auto/chats/:id` carries `previousVersion` (`CasePreviousVersion`: its steps, whether it has a Case Script, when it was replaced), and Apply and Restore push a `previous_version` event; Apply, ✕ and Reject all push a `draft` event (null once applied or rejected). Each route answers the chat.
- **Test tab:** ✕ on each changed, moved and added step in Changes and on every step in Full test; **Apply**, off with the reason under it until the draft has a passing Run (from the `draft` events, so it turns on as the Run passes and off as the draft changes); **Reject all**; and **Restore previous version** whenever the case has one, also once the draft is gone. Apply and Restore refetch the case for Test Cases.

In the desktop: the chat shows the **Run card** under the reply (progress such as "Step 3 of 5", time elapsed, each step with its status and commands, the vision Provider, and **Open Run**); a finished card stays until the next prompt. The composer shows **Stop** while the Run is live, and Esc stops it too, unless it is closing a menu or dialog. The Device tab overlays the Action in flight on the live frame, and says the device is view only while a Run holds it.

## How to verify

The draft Run groundwork: `bun test services/runner/src/domains/runs/draft-run.test.ts` (real catalog in a temp folder, the fake CDP browser, and a fake OpenAI-compatible endpoint as the vision Provider).

The chat: `bun test services/runner/src/interfaces/http/auto.test.ts` (the routes, the SSE stream, the Ask tools, the Case draft tools, Runs of the draft, and Apply, ✕, Reject all and Restore, including a script-mode Run of the applied case with Decide set to fail, with a scripted chat agent; the Runs use the real Run engine, the fake CDP browser and a fake vision Provider, `domains/runs/fake-vision.ts`) and `bun test services/runner/src/domains/auto/claude-agent.test.ts` (the contract with the Claude Agent SDK, its `query` faked). The screen's pure helpers: `bun test apps/desktop/src/mainview/features/auto`.

By hand:
1. Sign in the Claude Provider, connect a device, open **Auto**. With it signed out, Auto shows the empty state with a link to Settings → Providers → Claude.
2. On #8, choose **Chat about this case**, and in Ask mode ask "Why did the last run fail?" The reply streams in, read from #8's Runs (the tool calls show in the reply), and the device is untouched.

3. Switch to Run mode and ask "Fix #8: the Sign in button is now Log in." The Test tab fills with the Case draft as you watch: the changed step with its before and after and its reason, the unchanged steps collapsed. Full test shows the whole draft. Open #8 in Test Cases: its steps are as they were. Reopen the chat: the draft is still there.

4. Run mode: "Fix #8 so it passes." The Run card shows each step as it runs, with its commands, the time and the vision Provider, and the Device tab overlays the Action in flight. The Run appears on the Runs page labelled "Auto · <chat>"; #8's saved Case Script and last result are unchanged. Start another and press Esc: it stops.

5. Remove one draft step with ✕: Apply turns off, with why, until the draft passes again. Apply, then replay #8 with `yoqa script run` (or a script-mode Run): it passes with no Provider call. The Test tab shows no draft, and #8 in Test Cases has the new steps.
6. **Restore previous version** brings back the old steps and Case Script; pressing it again brings back the applied ones. **Reject all** on a new draft leaves #8 as it is.

## Follow-ups

- The chat Run follows a Run by reading it every 250 ms while the tool waits. If the runs domain gains a change feed, the Run card could use it instead.
- A failed Run of an unchanged draft keeps an earlier passing Run. If a flaky pass should not be enough to apply, clear the pass on any failed Run of the whole draft.

- Compare two Runs from the History tab.
- Codex as a second harness once the `codex` Provider supports a CLI login.
- Recording Take over Actions into the draft, if reproducing them by hand turns out to be painful.
- The packaged runner: the SDK starts Claude Code from a per-platform optional package, which the bundled npm runner may not carry. Check a packaged build; if it is missing, ship the SDK unbundled or point `pathToClaudeCodeExecutable` at the Claude CLI.
- Deleting a chat leaves its SDK session transcript under `~/.claude/projects/`; delete it with the SDK's `deleteSession` too.
- The Case draft compares against the case's steps as they were when it started (`base`). If the Test Case is edited in Test Cases meanwhile, Changes still shows the old before, and Apply refuses it (#458). The Test tab could say so before the user presses Apply.
- Reject all has no confirm (as Delete chat). If drafts get thrown away by mistake, add one.
- Reject all or Apply while a Run of the draft is going leaves that Run going (it no longer counts for anything). They could stop it.
- The `previous_version` event goes only to the chat that applied or restored. Other chats on the same Test Case see the change when they are opened again.
- The model list for an API-key login reads the Anthropic models endpoint each time; it could use the Provider's cached list (`listProviderModels`).
