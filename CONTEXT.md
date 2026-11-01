# Yoqa

Local-first agentic app QA for mobile and web: devices and browsers driven directly, runs driven by scripts or the Yoqa agent, BYO providers for vision and decide.

## Language

### Device layer

**Device Session**:
A live connection to one device (a phone, a simulator/emulator, or a Browser device) through one Lane, including gestures, screenshots, and app lifecycle control. On a Browser device it drives one page, and its coordinates are the page viewport, not the browser window. At most one Device Session may exist per device id at a time.
_Avoid_: Active session handle alone, WebDriver session (implementation detail), runner session

**Lane**:
The control path a Device Session uses to drive its device. A Lane is Direct only: straight to the platform tooling, with no WebDriver server in between. There is no other Lane and no capability that selects one. A connect opens the Direct lane, or it fails. `auto` and an explicit `direct` request open Direct when it can start; a client cannot name any other Lane. If Direct cannot start, the connect fails with that error. Yoqa does not install, start, or check an Appium Server. Android Direct is adb; iOS simulators are driven by our resident `yoqa-sim` and `yoqa-ax` (`device-sim`) with idb_companion as its fallback. A cabled iPhone is driven through our XCUITest `YoqaRunner` over usbmuxd (`device-ios`). The web Direct lane is the Chrome DevTools Protocol (CDP) to a Chromium browser, with no Playwright or WebDriver in between. Within a device class the Direct lane picks its implementation (a new one only when opted in, until it clears the benchmark gate) and falls back once, loudly, to the existing implementation; the Lane name stays `direct`. A Device Session has exactly one Lane for its whole life. An App and a Test Case do not carry capabilities. Saved keys are ignored and are not shown. They do not change the Lane or how an app is launched. The Run report names the Lane that ran.
_Avoid_: driver (Provider drivers), backend (runner / cloud), adapter, transport, engine

**Browser device**:
A Chromium-family browser (Chrome, Edge, Brave, Chromium, Dia, and the unverified Arc, Opera and Vivaldi) on macOS, as a `web` device. It has three ways in. A browser Yoqa launches uses its App's Kept profile, and disconnecting quits it; this is the default. An Everyday browser is the user's own, attached by consent. From the CLI or CI, a browser the user started with remote debugging on a non-default profile is attached by naming its debug port (`chromium-cdp-<port>`); ports are never scanned. Disconnecting an attached browser leaves it open.
_Avoid_: tab, page (one page of it is what a Device Session drives), web driver

**Everyday browser**:
The user's own running Chromium browser on its default profile, attached by consent: the user turns on the remote-debugging toggle at `chrome://inspect/#remote-debugging` and clicks Allow on each connect. Yoqa never launches, quits or reconfigures it. Yoqa drives only a page in its own window, never the user's tabs, and a Run uses it only when it names that device.
_Avoid_: user profile, real browser, attach by port (that is the CLI path)

**Kept profile**:
The browser profile Yoqa keeps for one App and one browser, under `~/.yoqa/browser-profiles/<app>/<browser>/` (`default` when no App is named), so logins survive disconnects, reconnects and Runs. Disconnecting keeps it; a reset deletes it. A Run may ask for a clean profile instead: a throwaway one, deleted on disconnect. Never the user's own browser profile.
_Avoid_: user profile, session storage, cookie jar

**Viewport preset**:
The page size a Device Session on a Browser device emulates, chosen at connect and fixed for the session's whole life: `desktop` (1280×800, the default) or `mobile` (390×844, with a mobile user agent and touch, so a tap or swipe is a finger). It applies to every page the session drives, whatever the window's size, and is what 0–1000 maps onto. The Run stores it and its report shows it.
_Avoid_: window size, resolution, device emulation (implementation detail)

**Active Session**:
The single Device Session shared across modes (connector / inspector / runs). A Run adopts it when it targets the same device and holds it view-only until the run finishes. It stays live until the user disconnects or connects another device. Its target app (what a Lane that remembers an app reads or relaunches) follows the Run that adopts it, or the app the user selects while no Run holds it, without reconnecting. On a cabled iPhone, frame and tree reads go through the Inspector Session and do not end this one.
_Avoid_: Run session (a Run adopts the Active Session), a second Device Session per mode

**Dead Session**:
A Device Session the runner still thinks is open but its Lane has already lost: the Direct lane's device tool says the device is gone, or the browser closed its connection or the page.
_Avoid_: disconnected (user-initiated), abandoned (implementation verb only)

**Unreachable Session**:
A Device Session whose device has briefly stopped answering, still inside the runner's grace window. The runner keeps it and says how long it will wait; if a gesture still cannot get through in time it becomes a Dead Session. Only the runner decides when an Unreachable Session is dead. The Inspector Session stays unreachable without becoming a Dead Session.
_Avoid_: stalled, zombie, "gone but still listed"

**Inspector Session**:
On a cabled iPhone, the link `device-ios` uses for a screenshot, the accessibility tree and the viewport. It is not a second Device Session and it does not start a second `YoqaRunner`. A usbmux miss on it answers unreachable and leaves the Device Session connected. Gestures use the Device Session's own link, and that link still ends the session when the phone stays unreachable past the grace window or the runner exits.
_Avoid_: a second Device Session, a second YoqaRunner, the Active Session itself

**Frame Feed**:
How the Inspector gets a Device Session's frames: a live _Stream_, or _Screenshot Poll_ (one screenshot at a time). A Lane with no stream always uses Screenshot Poll, and that is normal; only a Stream that should be there and did not answer is a failure. The Frame Feed says nothing about whether the session is connected.
_Avoid_: MJPEG unavailable (for a Lane that never streams), connecting (for a connected session without a Stream)

### Screen & action

**Screen**:
A reading of the device UI for agents: cleaned element tree with relative coordinates 0–1000, or the raw accessibility tree when full fidelity is requested. On the Android Direct lane the tree is system-wide (permission sheets, ANR dialogs). On the iOS Direct lane the tree is idb axbridge complete, including a system `modal`. The built-in Run agent does not see a Screen unless the Run opts into tree Screen mode.
_Avoid_: page source (WebDriver term alone), DOM

**Screen mode**:
How a Run presents the device to the agent when it decides. _Vision_ (the default) shows only the screenshot with the instruction; the agent names points by x,y. _Tree_ (opt-in per Run) also attaches the Screen.
_Avoid_: perception mode, input mode

**Grid mode**:
A way of presenting the screenshot in which a labeled grid is drawn on it and the agent names a cell and a position inside it instead of raw x,y. A case starts in Grid mode for a game, and is escalated into it from Vision when taps keep having no visible effect, after a Tree assist has had its chance.
_Avoid_: game mode (games are one trigger, not the definition), overlay

**Escalation**:
The one-way, per-case switch from plain x,y to Grid mode after four consecutive x,y taps leave the screenshot unchanged. It is recorded on the step that triggered it.

**Tree assist**:
A Vision-mode step that also gets the Screen tree, because the two actions before it left the screenshot unchanged (waits aside). It lasts while the screen stays unchanged, is recorded as `treeAssist` on the step, and is not used for a known game. The screenshot stays the ground truth. On such a step a plain x,y tap is snapped onto the nearest tappable control within 100 units (`snappedTo` on the step).
_Avoid_: fallback (implies going back), retry

**Grounding**:
Mapping a natural-language element description to coordinates on the current Screen / screenshot.
_Avoid_: locator, find element (when meaning description→coords)

**Action**:
A single device gesture or app-lifecycle command (tap, swipe, type, key, open URL, etc.), optionally grounded from a description. `key` presses one named key (Enter, Tab, Escape, arrows, …) with optional modifiers; each Lane declares the keys it can press, and any other key fails the Action. A swipe's direction is the way the finger moves, so `swipe up` scrolls the content down and reveals what is below; to **scroll** up is to swipe down.
_Avoid_: step (Run timeline), command (CLI)

**Settle**:
Waiting after an Action until the screenshot stops changing, bounded by a cap. An animating screen (typically a game) may never settle; the result then says it did not, and the latest frame is returned anyway.
_Avoid_: idle wait, sleep (a fixed delay is not a Settle)

**Result screenshot**:
The screenshot captured after an Action has settled, so the effect of that Action is seen without a separate capture. It is the raw device image and the stored ground truth (reports, assertions, replay). A connector caller is handed an Agent image of it by default; an annotated copy marks where the Action landed.
_Avoid_: post-action capture, verification screenshot

**Agent image**:
A reduced-size copy of a screenshot prepared for a model: what Decide sends to a Vision-capable Provider, and what a connector caller receives by default after an Action. Never the stored original; the raw frame is always kept.
_Avoid_: thumbnail, preview, compressed screenshot

### Providers

**Provider**:
A configured BYO backend for model auth, model listing, and (when capable) vision decide/ground.
_Avoid_: driver (implementation), LLM, model vendor alone

**Vision-capable Provider**:
A Provider that can decide the next Action or perform Grounding from a screenshot.
_Avoid_: any Provider with an API key

**Decide**:
A single vision completion by a Vision-capable Provider that maps the current screenshot and one instruction (plus the Screen, only in tree Screen mode) to the next Action.
_Avoid_: LLM call, inference, step (Run timeline)

**Prompt cache**:
A Provider's reuse of the unchanged leading part of a Decide or verify request across calls in the same Test Case, billed and served cheaper than fresh input.
_Avoid_: token cache (ambiguous with auth tokens), decision cache, response cache

**Call usage**:
The token accounting a Provider reports for one Decide or verify call: fresh input, Prompt cache reads, Prompt cache writes, and output.
_Avoid_: cost, tokens (alone), billing

### Catalog

**App Knowledge**:
A small, user-maintained notes document attached to one catalog app, available as decide context so recurring screens and flows are handled correctly.
_Avoid_: memory, learned context, app summary

**Flow**:
A named, reusable natural-language step (instructions and an expected result) kept on one catalog App and referenced by its Test Cases.
_Avoid_: Case Script, Case Script file (a replay of Actions is never a Flow)

### Runs

**Run**:
An execution of one or more Test Cases against a device, in script or agent mode.
_Avoid_: Job, job run, pipeline

**Run recording**:
An opt-in screen video of one Test Case within a Run, captured alongside its Result screenshots. A Test Case says whether it records (off by default); starting a Run can also ask to record every case. Evidence only: it is never shown to Decide and never takes part in Settle. It is playable only after the Run has finished. A Lane or device that cannot record leaves the Run unaffected and the case records why there is no video.
_Avoid_: screencast, clip, session recording

**Case executor**:
The module that runs one Test Case against a Device Session (script replay or agent loop), with abort, settle, and step recording injected at its seam.
_Avoid_: executeRun (orchestration + persistence around cases)

**Case Script**:
A saved replay of Actions and Branches for a Test Case, run without any live decide (a Branch reads the Screen; it never calls a Provider). A tap targets a label, an id, or x,y. There is one Case Script model: the catalog stores it, the Inspector edits it, and a Case Script file carries it.
_Avoid_: Flow (catalog term), shell script (an export, not the Case Script), agent instructions

**Branch**:
A Case Script step that checks the Screen once, waiting up to a timeout, for one text, and runs one of two action lists: `then` when the check is met, otherwise `else` (which may be absent). It is not an Action. Branches nest; there is no else-if. In a Case Script file it is written `- if:`. In a Run it is its own step saying which side ran, followed by that side's steps.
_Avoid_: conditional, if-step, if statement

**Case Script file**:
A Case Script written as YAML (`*.yoqa.yaml`), the default format for import and export. A legacy `.yoqa.json` file is still read as a Case Script file. A shell export is a one-way convenience: it can be run, but it is not a Case Script file.
_Avoid_: flow YAML, flow file, test file
