# yoqa-ax describe gives the Screen (`device-ax`)

## Goal

Ticket [#243](https://github.com/Aris-ngoy/qa-agent/issues/243) (spec [#233](https://github.com/Aris-ngoy/qa-agent/issues/233), plan [`device-ax`](../plans/device-lanes/device-ax.md) second slice). On an opted-in `device-sim` session, the Screen comes from `yoqa-ax` inside the simulator instead of idb_companion's `describe-all`:

- `describe` returns flat nodes: `role`, `label`, `value`, `id`, `frame` in 0.0–1.0, `enabled`.
- The Lane converts them to the 0–1000 Screen and caches the last tree by `yoqa-sim`'s frame hash.
- An empty tree is a valid answer with `degraded: true`.
- `describe` never foregrounds the app, and a tap never waits on it.

The connect-back helper itself is in [yoqa-ax-connect.md](./yoqa-ax-connect.md). Alerts (#244) come next.

## Plan summary

- **The read happens inside the simulator, in the one helper process.** `yoqa-ax` loads the simulator's private `AXRuntime` and uses its `AXElement` class:
  - `systemApplication` is SpringBoard. Its frame is the screen, in points.
  - `currentApplications` lists the foreground apps.
  - `explorerElements` gives each app's elements as VoiceOver visits them: flat, and on screen only.
  - It reads the foreground apps first, then SpringBoard, so the status bar and system modals are included.
  - It reads `label`, `value`, `axIdentifier` (the accessibility identifier), `traits` and `frame`.
- **App accessibility is turned on, `AutomationEnabled` is not.** Without `_AXSApplicationAccessibilitySetEnabled(true)`, running apps don't load their accessibility bundles, and Settings showed only SpringBoard's status bar. With it, an app that is already running is readable on the next read, with no relaunch. The flag is the `ApplicationAccessibilityEnabled` default in `com.apple.Accessibility`, the same switch an accessibility client sets.
- **Role and enabled come from the traits:** `SearchField`, `TextField` (the private text-entry bit, 1<<18), `Slider`, `Button`, `Link`, `Heading`, `Image`, `StaticText`, else `Other`. `notEnabled` gives `enabled: false`. Empty strings are left out, and zero-sized elements are dropped.
- **Degraded, not blocked.** An empty read answers `{"nodes":[],"degraded":true}`. Off the simulator there is no AXRuntime, so the host-built binary always answers that. The Lane returns an empty Screen and doesn't cache it, so the next read tries again. The raw (`full`) source carries `"degraded": true`. The Screen response schema is unchanged.
- **Cache by frame hash.** Before each read, the Lane reads `yoqa-sim`'s current frame hash. The hash is read first, so a screen that changes during the read is read again next time. An unchanged hash returns the cached tree.
- **Into the existing Screen path.** The Lane writes the nodes as idb `describe-all` JSON, with frames in window points, so `cleanPageSource`, alert resolution and locators read them unchanged. `value` goes in `title`, so an element with only a value (a status bar item) is still named.
- **Taps never wait.** Actions start `yoqa-ax` in the background as before. A tree read waits for it to connect, and that is at most 10 s, once per session. A slow read doesn't hold the action lock.
- **Fallback, once and loudly.** A `describe` that fails or times out (5 s) stops `yoqa-ax`. The tree then comes from idb_companion for the rest of the session, with a Lane warning: `yoqa-ax failed; reading the tree with idb_companion for the rest of the session (…)`. A helper that never connected keeps #242's degraded warning and idb_companion's tree. A read that fails because the session is quitting rethrows, with no warning and no idb read. The Lane itself never changes, as ADR-0004 requires.
- Rejected:
  - a host-side AX walk (the `AXPTranslator` path idb uses), which costs a round trip per attribute;
  - falling back to idb on an empty read, which would make the degraded case slow, the thing this slice avoids;
  - adding a `degraded` field to the Screen response, which would change the HTTP schema.

## What shipped

- `native/yoqa-ax/`
  - `YoqaAxCore/Tree.swift`: `AXNode`, `Tree` (degraded when empty), `RawElement`, and the points-to-fractions and traits-to-role mapping.
  - `Handler`: `describe`, from an injected reader.
  - `yoqa-ax/AXRuntimeReader.swift`: the in-simulator reader.
  - Tests (18): handler replies, node mapping (fractions, roles, disabled, empty text, zero size, no screen), and the host-built binary answering a degraded-empty `describe` at its wire protocol.
- `services/runner/src/domains/devices/`
  - `yoqa-ax.ts`: `YoqaAx.describe()` and the `YoqaAxNode` / `YoqaAxTree` types. A reply without `nodes` is an error.
  - `ios-direct-lane.ts`: `pageSource` reads from `yoqa-ax`, with the frame-hash cache, degraded-empty and the idb fallback. `yoqaAxTreeToSource` does the conversion.
  - `lane-harnesses.ts` / `lane-contract.test.ts`: a `device-sim with yoqa-ax` harness whose idb tree read isn't faked, so the contract's Screen must come from `yoqa-ax`.
  - `ios-yoqa-sim-lane.test.ts` (+6):
    - the Screen comes from `yoqa-ax`;
    - the cache follows the hash;
    - an empty read is degraded and isn't cached;
    - a failed `describe` falls back loudly;
    - quit during a read doesn't warn;
    - a tap doesn't wait on a slow read.

## Measurements

iPhone 17 Pro simulator (iOS 26.5), Xcode 27, Apple silicon, release build, Settings:

- At the socket: first `describe` 70 ms, warm 22–24 ms, 19 nodes. Before accessibility was turned on, the first read after Settings launched took 243 ms while Settings loaded its accessibility bundles.
- Through the Lane (`getScreen`, idb stubbed):
  - first read 856 ms, including the helper's spawn and connect;
  - a read on a new frame 35–80 ms (General after navigating: 71 ms);
  - a cached read on an unchanged frame 0.4–1.4 ms.
- No idb tree read and no Lane warning. The helper and its socket were gone after quit.

## How to verify

1. `cd native/yoqa-ax && xcrun swift test`
2. Build for the simulator (see [yoqa-ax-connect.md](./yoqa-ax-connect.md)).
3. `bun test ./services/runner/src/domains/devices/{yoqa-ax,ios-yoqa-sim-lane,lane-contract}.test.ts`
4. Live:
   - Start the runner with `YOQA_DIRECT_IOS_SIMULATOR=device-sim` and connect a booted simulator on the Direct lane.
   - Open Settings and read the Screen. The elements carry Settings' identifiers (`com.apple.settings.general`), and the session has no Lane warning.

## Follow-ups

- #244: `alert`, the SpringBoard dialog read.
- The 50 ms target is met at the socket (about 23 ms). Through the Lane, a read on a new frame took 35–80 ms. Part of that is fetching the whole frame to get its hash. A hash-only `yoqa-sim` route would cut it.
- `degraded` reaches only the raw (`full`) source. Putting it on the Screen response is a schema change for #233's follow-ups to decide.
- Frames are converted with the window size read at connect, as idb's tree already is. A rotated simulator would need it refreshed.
- A failed hash read is a failed `yoqa-sim` frame read, and it ends `yoqa-sim` for the session, the same as `captureFrame`.
- The benchmark against idb's `describe-all` on the same simulator, before #245 promotes it.
- In this session, Lane taps through `yoqa-sim` didn't navigate Settings, while argent's tap did. That is the #240 input path, flagged separately.
