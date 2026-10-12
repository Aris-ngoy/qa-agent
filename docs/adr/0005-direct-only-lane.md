---
status: accepted
---

# A Lane is Direct only: Appium is removed

[ADR-0004](./0004-device-session-lanes.md) kept Appium as a product pillar next to the Direct lanes: the Lane for custom capabilities and the fallback when Direct could not start. That is no longer true. Every platform now has a Direct implementation that cleared the benchmark gate (adb on Android, `device-sim` on iOS simulators, `YoqaRunner` on a cabled iPhone), and Apps and Cases no longer carry the capabilities that pinned Appium ([no-appium-capabilities.md](../catalog/no-appium-capabilities.md)). A connect opens Direct or fails with Direct's error ([no-appium-acquire.md](../devices/no-appium-acquire.md)). Nothing chooses the Appium lane any more.

We remove it. Yoqa does not install, start, or check an Appium Server, and the runner has no WebDriver client.

- **A Lane is Direct only.** `LaneName` is `direct`. A client cannot name another Lane: the connect and Run schemas reject it, and the CLI accepts `direct` or `auto`.
- **No second try.** If Direct cannot start, the connect fails with that error. There is no fallback Lane. Fallbacks inside the Direct lane (a new implementation to an existing one, `device-sim` to idb_companion) stay, and stay loud.
- **No Appium words in the product.** The session pill, a Run report, Doctor, Servers, the CLI, and the skill never name Appium. The `runtime` and `setup` commands and routes are gone with the runtime they managed.
- **Android toolchain settings stay.** The SDK and JDK paths still feed the Direct lane's adb and tooling.
- **What ADR-0004 still governs.** One Lane for the whole session, the benchmark gate for promoting a Direct implementation, and the rule that the Run report names the Lane that ran.

## Considered options

- **Keep the Appium code behind an unreachable flag:** rejected. Dead code that can still be reached by an old client or a stale catalog row is how a "fallback" returns.
- **Keep the runtime installer for users who want Appium:** rejected. Yoqa would still own a Node, npm and driver install it never uses.

## Consequences

- Run rows saved before this change may carry `appium` as their Lane. A report reads them as having no Lane and does not print the word.
- Physical iPhones no longer have WebDriverAgent anywhere in the product. Signing settings now serve `YoqaRunner` only.
- The leftover `appium_caps` column on Apps and Cases stays in the catalog so old databases still open. Dropping it is a separate migration.
