# Agent CLI action parity + screenshot + tree

## Goal

The catalog AI agent should be able to take every action `yoqa action` / `yoqa assert` can, and should decide using **both** the screenshot image and the cleaned screen snapshot (`yoqa screen` tree). If a tap or other locator action misses, retry with that combined view instead of guessing the same target.

## Plan summary

- Map vision JSON onto the same `ActionRequest` the CLI posts (`performAction` in-process — the agent already runs inside the runner, so it must not spawn `yoqa`).
- Each step attaches a screenshot **and** a compact cleaned-tree listing on the same 0–1000 grid. Tree `id=` wins for taps; permission labels stay locators; other in-app taps still use screenshot coords.
- On `ActionNotFoundError` / validation errors: re-ask the model with `Last action error` plus the same screenshot + snapshot. If the failed tap had both a locator and `x,y`, inject the screenshot point immediately without a second model call.
- Persist the new kinds on CaseScript so a passed agent run can replay without the model.

Rejected: nested `yoqa` CLI from inside the runner (same Device Session); treating an empty tree as “no screenshot”.

## What shipped

**Agent decisions** — same kinds as `yoqa action` plus assert:

| CLI | Agent JSON |
|-----|------------|
| `yoqa action tap` (`--id` / `--label` / `--x --y` / `--description` / `--double` / `--duration`) | `tap` |
| `yoqa action swipe` | `swipe` (`direction` or `x,y,x2,y2`) |
| `yoqa action drag` | `drag` |
| `yoqa action input` | `type` or `input` |
| `yoqa action alert` | `alert` |
| `yoqa action activate-app` / `terminate-app` / `restart-app` | same; omit `appId` to use the catalog bundle / application id |
| `yoqa action background-app` | `background-app` |
| `yoqa action open-url` | `open-url` |
| `yoqa assert visible\|not-visible` | `assert` |

**Executor**

- `GET /screen` cleaned tree (not full XML) is formatted and sent with every vision call.
- Locator miss → one model retry with the error, or screenshot-coord fallback when `x,y` were already present.
- Script replay performs drag, app lifecycle, open-url, double-tap, and long-press.

**Client / desktop**

- CaseScript, shell export/import, run-report summaries, and the case Script tab cover the new action types.

## How to verify

1. Restart the desktop / runner sidecar so it picks up runner TypeScript.
2. Run a case with **Use AI agent** (not an old saved script).
3. Steps should include swipe/drag/input/assert/app actions when the instructions need them — not only tap.
4. A bad `--id` should not stall: the next step uses the snapshot `id=` or screenshot `x,y`, and the run log’s thoughts mention the previous miss.
5. After a pass, Script tab / exported shell should replay `yoqa action drag|restart-app|open-url|…`.

## Follow-ups

- `scrollUntilVisible` (keep swiping until a label appears)
- Optional tree refresh after a failed locator before the retry decide
