# yoqa-testing

Local device QA loop for coding agents using the `yoqa` CLI.

## Inspect → act → verify

1. Ensure the local runner is up (`yoqa health`).
2. Connect a device (`yoqa devices connect <id>`).
3. Inspect the screen (`yoqa screen` or `yoqa screenshot <path>`).
4. Act with coordinates or descriptions (`yoqa action …`).
5. Re-inspect and verify the expected result.

Phase 1 is local-only: no account, no cloud grounding.
