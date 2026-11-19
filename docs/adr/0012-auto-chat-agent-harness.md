---
status: partly superseded by ADR 0014
---

> Partly superseded by [ADR 0014](./0014-auto-chat-on-any-chat-capable-provider.md): the chat agent is no longer signed in only through the `claude` Provider. Any Chat-capable Provider can answer a chat; the Claude Provider keeps the Claude Agent SDK, and every other Provider runs on a Yoqa-owned AI SDK loop. The rest of this record stands.

# The Auto chat runs on the Claude Agent SDK and leaves device work to the Case executor

The Auto chat needs an agent that can be told "#8 Payout keeps failing, fix it" and then read past Runs, find the cause, rewrite steps and run them without being babysat. The Yoqa agent cannot: it is one stateless vision Decide per Action and never plans. So the chat agent is the Claude Agent SDK, signed in through the existing `claude` Provider (the Claude Code CLI login or an Anthropic API key), with Yoqa operations as its only tools: read the catalog and Runs, write the Case draft, start a Run, and, in Explore, read the Screen and act. When a Run executes steps, the device is still driven by the Case executor (the Yoqa agent or script replay), and the chat agent reads only text summaries of its steps. Screenshots never enter the chat's context, so long chats stay cheap and the SDK's own compaction is enough.

## Considered options

- **The Yoqa agent behind a chat UI:** rejected. Fast and already context-bounded, but it carries out one instruction at a time and cannot diagnose a failing case or plan a test.
- **The SDK drives the device itself, Action by Action:** rejected. Every screenshot lands in the chat's context, which is the babysitting and context growth the Auto chat exists to avoid, and it is slower per Action than a Decide.
- **Codex as the first harness:** deferred. The `codex` Provider cannot yet run on a CLI login (`providers/drivers/codex.ts`).

## Consequences

- The agent writes only a Case draft. The catalog changes only when the user applies the draft after a passing Run of the whole of it, and a Run of a draft never overwrites the saved Case Script (today a passing agent Run does).
- Claude Code's built-in tools and the user's own settings, CLAUDE.md and skills are not given to the chat agent; its only tools are Yoqa's.
- The `claude` Provider gains a second use (text chat) beside its listing and login; it is still not a Vision-capable Provider.
