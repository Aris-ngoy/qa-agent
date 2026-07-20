# qa-agent-testing

Local device QA loop for coding agents using the `qa-agent` CLI.

## Inspect → act → verify

1. Ensure the local runner is up (`qa-agent health`).
2. Connect a device (`qa-agent devices connect <id>`).
3. Inspect the screen (`qa-agent screen` or `qa-agent screenshot <path>`).
4. Act with coordinates or descriptions (`qa-agent action …`).
5. Re-inspect and verify the expected result.

Phase 1 is local-only: no account, no cloud grounding.
