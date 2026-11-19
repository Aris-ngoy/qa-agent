# The vision Provider when the default cannot see

## Goal

Every agent Run failed with `Provider kind "claude" does not support vision runs yet` once Claude was the default Provider, even with other Vision-capable Providers enabled. Since the Auto chat starts new chats on the default Provider ([auto-chat.md](../auto/auto-chat.md), ADR 0014), making Claude the default is a natural thing to do, and it should not stop Runs.

## Plan summary

Runs, element grounding and the Run card took their vision Provider from the default Provider alone (`resolveActiveProviderAuth`), and the Claude Provider has no vision port (ADR 0012). Now they take the default Provider when it is Vision-capable, else the first enabled Provider that is, oldest first. Rejected: a second default in Settings for Runs (a schema and UI change for a choice most people never need to make), and only a better error (it would still have made you pick between chats and Runs).

## What shipped

- `resolveVisionProviderAuth()` in `domains/providers/application.ts`: enabled Providers, default first then by age, the first whose driver has a vision port. When none has one, it still returns the default, so `assertVisionCapableProvider` keeps its message naming why; null when no Provider is enabled.
- Run validation (`runs/application.ts`), Run setup (`runs/run-setup.ts`), grounding (`devices/grounding.ts`) and the Auto Run card's Provider label (`auto/chat-runs.ts`) use it. `GET /status` still reports the default Provider.

## How to verify

- `bun test services/runner/src/interfaces/http/auto.test.ts -t "cannot see"`: Claude is the default and the oldest Provider, and the chat's Run still passes on the Fake vision Provider, named on the Run card.
- In the app: make the Claude Provider the default in Settings → Providers with another Vision-capable Provider enabled, then run an agent-mode case. It runs, and the Run card names the Provider it used.

## Follow-ups

- Settings could say which Provider Runs will use when the default cannot see.
