---
status: accepted
---

# The Auto chat runs on any Chat-capable Provider: the Claude Agent SDK for Claude, a Yoqa-owned AI SDK loop for the rest

Supersedes [ADR 0012](./0012-auto-chat-agent-harness.md) where they conflict: the chat agent is no longer signed in only through the `claude` Provider. ADR 0012's other decisions stand: the agent's only tools are Yoqa's, it writes only a Case draft, the Case executor drives the device when a Run executes steps, and screenshots never enter the chat.

People who pay for OpenAI, Google, Groq, Grok, GitHub Copilot, a Custom endpoint, or Codex, OpenCode or Antigravity with an API key could not use Auto without adding a Claude account. So any Chat-capable Provider can be the chat's agent, and each chat has its own Provider and model. The Claude Provider keeps the Claude Agent SDK, through its CLI login or an API key. Every other Chat-capable Provider runs on one agent loop Yoqa owns, on the AI SDK the runner already uses for vision: a streaming text call that repeats while the model calls the mode's Yoqa tools, up to a fixed cap of tool steps. Each driver declares, beside its vision ability, the auth modes it can chat in, and gives the loop a chat model factory built on its vision port's vendor client and key resolution. A routing chat agent behind the existing `ChatAgent` port picks the adapter per chat, so the HTTP layer and its tests still see one agent.

## Considered options

- **One adapter per vendor agent SDK:** rejected. Several vendors have no agent SDK, and Groq, Grok and Custom endpoints would not be covered at all.
- **Moving the Claude Provider onto the AI SDK loop too:** rejected. The Claude CLI login is only usable through Claude Code, so Claude would lose its subscription login.
- **CLI-login harnesses first** (Codex CLI, OpenCode CLI, Cursor CLI, Antigravity CLI): deferred. Each needs its own harness that drives the CLI headless with Yoqa's tools served over a runner MCP endpoint. Until then those modes are not Chat-capable, and the picker says so and points to the API-key mode.

## Consequences

- The AI SDK loop owns its context: its history (model messages with tool calls and results) is saved per chat, as the Claude SDK session id is, and long chats are compacted into a saved summary by the same model. The Claude Provider still relies on the SDK's own compaction.
- Switching Provider drops the old agent's private history or session; the new agent starts from the chat's visible conversation and reads anything else again with Yoqa's tools. Switching model within a Provider keeps it.
- A chat whose Provider is removed, disabled or signed out fails its next message with why. There is no silent fallback to another Provider.
- Tool-call support is not listed per model. A model that cannot call tools fails its turn with a sentence saying so, as vision support is handled.
- Cursor is not Chat-capable in any mode yet: its API key also goes through `cursor-agent`, so it needs the same CLI harness as its login.
- Runs started from the chat still use the app's default vision Provider, whichever Provider writes the chat.
