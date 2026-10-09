# device-ax

Guest helper. Spawned into the booted simulator with `simctl spawn`. Reads the accessibility tree. The iOS-simulator Direct lane's tree source, ahead of idb's `describe-all`, which stays as the fallback.

Last package. It has nothing to cache against until `device-sim` has a frame hash. Do not block a tap on this package. Yoqa still has the frame.

The runner binds the socket first, then spawns:

```text
xcrun simctl spawn <udid> yoqa-ax --connect /tmp/yoqa-ax-<udid8>.sock
```

Unix socket on the host. TCP only if the simulator is remote and a socket cannot cross the tunnel. The helper connects back. The runner waits up to 10 s, then marks the session degraded.

## First slice

`simctl spawn`, connect back to the socket, and `ping`.

## Second slice

`describe` on Settings. Flat nodes: `role`, `label`, `value`, `id`, `frame` in 0.0–1.0, `enabled`. An empty tree is a valid response, with `degraded: true`.

Prefer a guest read, the shape of idb's `SimulatorFrameworkBridge`: one process inside the sim, reused for every call. A host-side AX walk is the fallback, and it is slower because each attribute is a round trip.

Do not set `AutomationEnabled`. On current sims it hangs the query.

Cache the last tree keyed by frame hash from `device-sim`. If the hash did not change, return the cache.

## Third slice

`alert`. Buttons and title of a SpringBoard dialog, or empty. This helper must read SpringBoard, or alerts are invisible.

Request framing is length-prefixed JSON, one in flight:

| Method | Returns |
| --- | --- |
| `ping` | `ok` |
| `describe` | Flat nodes |
| `alert` | Buttons and title, or empty |

`describe` does not foreground the app.

## Done

A warm `describe` of Settings is under 50 ms, and an empty read is reported instead of blocking.

## Out of scope

Touch, screenshots, physical iPhones, dylib injection.
